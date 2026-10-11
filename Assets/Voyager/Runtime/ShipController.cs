using System;
using UnityEngine;
using Voyager.Core;

namespace Voyager
{
    public sealed class ShipController : MonoBehaviour
    {
        [Header("Near-surface PhysX tuning")]
        public float shipMassKg=12000;
        public float angularResponse=8;
        public float brakeResponse=8;
        public float surfaceSpeedMps=1000;
        public double cruiseSpeedKm=100;
        public bool assist=true;
        public string systemId="solar", targetId="earth";
        public Double3 Position {get;private set;}
        public Double3 Velocity {get;private set;}
        public Double3 Origin {get;private set;}
        public BodyData Nearby {get;private set;}
        public BodyData Landed {get;private set;}
        public Rigidbody Body {get;private set;}
        public WorldCatalog Catalog=>world;
        public bool LocalPhysics {get;private set;}
        public bool Walking {get;set;}
        public bool Descending {get;private set;}
        public bool Warping=>warpStage==1 || warpStage==2;
        public string WarpStatus=>warpStage==1?"蓄能":warpStage==2?"航道":warpStage==3?"冷却":"就绪";
        public float Thrust {get;private set;}
        public event Action<Vector3> OriginShifted;
        WorldCatalog world;
        LocalTerrain terrain;
        Vector3 thrustInput,turnInput;
        bool brake,boost;
        int warpStage;
        double warpClock;
        Double3 warpFrom,warpTo;
        BodyData warpBody;
        public void Initialize(WorldCatalog catalog,LocalTerrain localTerrain)
        {
            world=catalog;terrain=localTerrain;
            Body=gameObject.AddComponent<Rigidbody>();Body.mass=shipMassKg;Body.useGravity=false;
            Body.drag=0;Body.angularDrag=0;Body.maxAngularVelocity=2;
            Body.collisionDetectionMode=CollisionDetectionMode.ContinuousDynamic;
            Body.solverIterations=12;Body.solverVelocityIterations=6;
            BoxCollider collider=gameObject.AddComponent<BoxCollider>();collider.size=new Vector3(18,5,24);collider.center=new Vector3(0,0,-2);
            PhysicMaterial contact=new PhysicMaterial("Hull contact") {dynamicFriction=.8f,staticFriction=.9f,bounciness=0};collider.sharedMaterial=contact;
            JumpTo(world.Find("earth"));
        }
        public void ReadInput()
        {
            if(Walking || Warping) {thrustInput=turnInput=Vector3.zero;brake=boost=false;return;}
            float Key(KeyCode positive,KeyCode negative)=>(Input.GetKey(positive)?1:0)-(Input.GetKey(negative)?1:0);
            thrustInput=new Vector3(Key(KeyCode.D,KeyCode.A),Key(KeyCode.R,KeyCode.F),Key(KeyCode.W,KeyCode.S));
            thrustInput=Vector3.ClampMagnitude(thrustInput,1);
            turnInput=new Vector3(Key(KeyCode.DownArrow,KeyCode.UpArrow),Key(KeyCode.RightArrow,KeyCode.LeftArrow),Key(KeyCode.Q,KeyCode.E));
            brake=Input.GetKey(KeyCode.Space);boost=Input.GetKey(KeyCode.LeftShift)||Input.GetKey(KeyCode.RightShift);
            if(Input.GetKeyDown(KeyCode.G)) assist=!assist;
            if(Input.GetKeyDown(KeyCode.T)) AlignToTarget();
            if(Input.GetKeyDown(KeyCode.L)) ToggleLanding();
            if(Input.GetKeyDown(KeyCode.J)) StartWarp();
        }
        public void TickBefore(float dt)
        {
            if(warpStage!=0) {StepWarp(dt);if(Warping) return;}
            if(Walking || Landed!=null) {Thrust=0;return;}
            Nearby=world.Nearest(systemId,Position);
            double altitude=world.Surface.Altitude(Nearby,Position-Nearby.positionM);
            if(Nearby.solid && altitude<10000 && !LocalPhysics) EnterLocal();
            // Hysteresis includes the conservative terrain envelope used by the cruise sweep.
            if(LocalPhysics && altitude>world.Surface.MaxHeight(Nearby)+18000) LeaveLocal();
            if(Descending && (thrustInput.sqrMagnitude>0 || turnInput.sqrMagnitude>0 || brake)) Descending=false;
            Vector3 desiredAngular=Body.rotation*turnInput*1.25f;
            Body.AddTorque((desiredAngular-Body.angularVelocity)*angularResponse,ForceMode.Acceleration);
            Double3 radial=Position-Nearby.positionM;
            Double3 gravity=PhysicsMath.Gravity(radial,Nearby.radiusM,Nearby.gravity);
            Vector3 direction=(Body.rotation*thrustInput);
            Thrust=thrustInput.magnitude;
            double speedLimit=LocalPhysics?surfaceSpeedMps:cruiseSpeedKm*1000;
            double acceleration=speedLimit*(boost?1.5:.6);
            double drag=PhysicsMath.Density(Nearby.density,altitude,Nearby.scaleHeightM,Nearby.atmosphereM)*.45;
            Double3 effective=assist?Double3.Zero:gravity;
            bool reversing=thrustInput.z<0 && Double3.Dot(Velocity,(Body.rotation*Vector3.forward).Double())>.1;
            bool stopping=brake || reversing;
            if(Descending)
            {
                Double3 up=radial.Normalized;
                Vector3 tangent=Vector3.ProjectOnPlane(Body.rotation*Vector3.forward,up.Float()).normalized;
                if(tangent.sqrMagnitude<.1) tangent=Vector3.Cross(up.Float(),Vector3.right).normalized;
                Body.rotation=Quaternion.Slerp(Body.rotation,Quaternion.LookRotation(tangent,up.Float()),dt*2);
                Double3 desired=-up*Math.Min(400,Math.Max(.6,(altitude-2)*.25));
                effective+=(desired-Velocity)*3-gravity*(assist?0:1);
                Thrust=.35f;
            }
            else
            {
                if(stopping) effective-=Velocity*brakeResponse;
                else if(Thrust>0)
                {
                    if(assist)
                    {
                        Double3 desired=direction.Double()*speedLimit;
                        Double3 next=PhysicsMath.ApproachVelocity(Velocity,desired,acceleration,dt);
                        effective+=(next-Velocity)/dt;
                    }
                    else
                    {
                        effective+=direction.Double()*acceleration;
                        Double3 predicted=Velocity+effective*dt;
                        if(predicted.Magnitude>speedLimit && predicted.Magnitude>Velocity.Magnitude)
                            effective=(predicted.Normalized*Math.Max(speedLimit,Velocity.Magnitude)-Velocity)/dt;
                    }
                }
                else if(assist) effective-=Velocity*.1;
                // Unpowered atmospheric drag is separate from vacuum flight assistance.
                if(Thrust==0) effective-=Velocity*Math.Min(4,drag);
            }
            if(LocalPhysics)
            {
                terrain.Refresh(world,Nearby,Position,Origin,false);
                Body.AddForce(effective.Float(),ForceMode.Acceleration);
            }
            else
            {
                Velocity+=effective*dt;
                Double3 next=Position+Velocity*dt;
                BodyData boundary=null;double fraction=1;
                foreach(BodyData b in world.Data.bodies)
                {
                    if(b.systemId!=systemId || b.kind=="station") continue;
                    double radius=b.radiusM+world.Surface.MaxHeight(b)+(b.solid?9500:Math.Max(1000,b.radiusM*.01));
                    if(PhysicsMath.SweepSphere(Position,next,b.positionM,radius,out double t) && t<fraction)
                    {boundary=b;fraction=t;}
                }
                Position=Double3.Lerp(Position,next,fraction);
                if(boundary!=null)
                {
                    Nearby=boundary;
                    if(boundary.solid) {Velocity=Velocity.Normalized*Math.Min(1000,Velocity.Magnitude);EnterLocal();}
                    else {Velocity=Double3.Zero;Position+= (Position-boundary.positionM).Normalized*10;}
                }
                if(!LocalPhysics) {Origin=Position;Body.position=Vector3.zero;}
            }
        }
        public void TickAfter()
        {
            if(!LocalPhysics || Walking || Warping) return;
            Position=Origin+Body.position.Double();Velocity=Body.velocity.Double();
            Rebase();
        }
        void EnterLocal()
        {
            LocalPhysics=true;Origin=Position;Body.position=Vector3.zero;Body.velocity=Velocity.Float();
            Body.detectCollisions=true;terrain.Refresh(world,Nearby,Position,Origin,false,true);
        }
        void LeaveLocal()
        {
            LocalPhysics=false;Origin=Position;Body.position=Vector3.zero;Body.velocity=Vector3.zero;
            Body.detectCollisions=false;terrain.gameObject.SetActive(false);
        }
        public void Rebase(Vector3? focus=null)
        {
            Vector3 shift=focus??Body.position;
            if(shift.magnitude<1000) return;
            Origin+=shift.Double();Body.position-=shift;terrain.Shift(shift);OriginShifted?.Invoke(shift);Physics.SyncTransforms();
        }
        public void JumpTo(BodyData body)
        {
            if(body==null) return;
            Walking=false;Landed=null;Descending=false;warpStage=0;
            Body.isKinematic=false;systemId=body.systemId;targetId=body.id;Nearby=body;
            Double3 side=new Double3(0,.25,-1).Normalized;
            double height=body.kind=="black-hole"?body.radiusM*7:body.solid?1100000:Math.Max(body.atmosphereM*2,body.radiusM*3);
            Position=body.positionM+side*(body.radiusM+height);Velocity=Double3.Zero;
            LeaveLocal();Body.angularVelocity=Vector3.zero;AlignToTarget();
        }
        public void AlignToTarget()
        {
            BodyData target=world.Find(targetId);
            if(target==null || target.systemId!=systemId) return;
            Vector3 forward=(target.positionM-Position).Normalized.Float();
            Body.rotation=Quaternion.LookRotation(forward,Mathf.Abs(forward.y)>.99f?Vector3.forward:Vector3.up);
            Body.angularVelocity=Vector3.zero;
        }
        public bool StartWarp()
        {
            if(Landed!=null || Walking || warpStage!=0) return false;
            warpBody=world.Find(targetId);
            if(warpBody==null) return false;
            Descending=false;warpFrom=Position;
            Double3 direction=warpBody.systemId==systemId?(Position-warpBody.positionM).Normalized:new Double3(0,.25,-1).Normalized;
            double safe=warpBody.solid?1100000:Math.Max(warpBody.atmosphereM*2,warpBody.radiusM*(warpBody.kind=="black-hole"?7:3));
            warpTo=warpBody.positionM+direction*(warpBody.radiusM+safe);
            warpStage=1;warpClock=0;LeaveLocal();Body.isKinematic=true;
            return true;
        }
        void StepWarp(float dt)
        {
            warpClock+=dt;
            if(warpStage==1 && warpClock>=1.6) {warpStage=2;warpClock=0;}
            if(warpStage==2)
            {
                double t=Math.Min(1,warpClock/10.2);double smooth=t*t*(3-2*t);
                // Local interpolation applies only within a system; cross-system transit changes reference once.
                if(warpBody.systemId==systemId)
                {
                    Double3 next=Double3.Lerp(warpFrom,warpTo,smooth);
                    double entry=1;bool blocked=false;
                    foreach(BodyData body in world.Data.bodies)
                    {
                        if(body.systemId!=systemId || body.kind=="station") continue;
                        double exclusion=body.radiusM+world.Surface.MaxHeight(body)+Math.Max(1000,body.radiusM*.01);
                        if(PhysicsMath.SweepSphere(Position,next,body.positionM,exclusion,out double hit) && hit<entry) {entry=hit;blocked=true;}
                    }
                    Position=Double3.Lerp(Position,next,entry);
                    if(blocked)
                    {
                        Origin=Position;Body.position=Vector3.zero;Velocity=Double3.Zero;
                        Body.isKinematic=false;Body.velocity=Vector3.zero;warpStage=3;warpClock=0;return;
                    }
                }
                Origin=Position;Body.position=Vector3.zero;
                if(t>=1)
                {
                    systemId=warpBody.systemId;Position=Origin=warpTo;Velocity=Double3.Zero;Nearby=warpBody;
                    Body.isKinematic=false;Body.velocity=Vector3.zero;warpStage=3;warpClock=0;AlignToTarget();
                }
            }
            if(warpStage==3 && warpClock>=2) {warpStage=0;warpClock=0;}
        }
        public void ToggleLanding()
        {
            if(Walking || Warping) return;
            if(Landed!=null)
            {
                Vector3 up=(Position-Landed.positionM).Normalized.Float();
                Body.isKinematic=false;Body.position+=up*2;Position=Origin+Body.position.Double();
                Body.velocity=up*25;Velocity=Body.velocity.Double();Landed=null;Descending=false;
                return;
            }
            BodyData target=world.Find(targetId);
            if(target==null || !target.solid || target!=Nearby || !LocalPhysics) return;
            Descending=!Descending;
        }
        public void PlaceOnSurface(BodyData body)
        {
            if(!body.solid) return;
            JumpTo(body);
            Double3 up=new Double3(0,1,0);
            Position=body.positionM+up*(world.Surface.Radius(body,up)+3);
            Origin=Position;Velocity=Double3.Zero;EnterLocal();Body.rotation=Quaternion.identity;
            Landed=body;Body.isKinematic=true;Descending=false;
        }
        public void RefreshWalkingTerrain(Double3 feet,bool force=false) => terrain.Refresh(world,Landed,feet,Origin,true,force);
        public void RefreshFlightTerrain() => terrain.Refresh(world,Nearby,Position,Origin,false,true);
        public bool Restore(string system,string target,Double3 position,Double3 velocity,Quaternion rotation,bool assistance,string landed)
        {
            BodyData selected=world.Find(target),ground=world.Find(landed);
            bool knownSystem=Array.Exists(world.Data.systems,s=>s.id==system);
            if(selected==null || !knownSystem || !position.IsFinite || !velocity.IsFinite || velocity.Magnitude>150000000) return false;
            if(!string.IsNullOrEmpty(landed) && (ground==null || !ground.solid || ground.systemId!=system || world.Surface.Altitude(ground,position-ground.positionM)<.5 || world.Surface.Altitude(ground,position-ground.positionM)>15 || velocity.Magnitude>.01)) return false;
            float length=rotation.x*rotation.x+rotation.y*rotation.y+rotation.z*rotation.z+rotation.w*rotation.w;
            if(float.IsNaN(length) || float.IsInfinity(length) || length<.9f || length>1.1f) return false;
            Walking=false;Landed=null;Descending=false;warpStage=0;Body.isKinematic=false;
            systemId=system;targetId=target;Position=position;Origin=position;Velocity=velocity;assist=assistance;
            Nearby=world.Nearest(system,Position);Body.position=Vector3.zero;Body.rotation=rotation.normalized;Body.angularVelocity=Vector3.zero;
            double altitude=world.Surface.Altitude(Nearby,Position-Nearby.positionM);
            if(Nearby.solid && altitude<10000) EnterLocal();else LeaveLocal();
            Landed=ground;if(Landed!=null) Body.isKinematic=true;
            return true;
        }
        void OnCollisionEnter(Collision collision)
        {
            if(!LocalPhysics || Nearby==null || !Nearby.solid || Landed!=null) return;
            Vector3 up=(Position-Nearby.positionM).Normalized.Float();
            if(collision.relativeVelocity.magnitude<8 && Vector3.Dot(Body.rotation*Vector3.up,up)>.7f)
            {
                Position=Origin+Body.position.Double();Velocity=Double3.Zero;Body.velocity=Vector3.zero;Body.angularVelocity=Vector3.zero;
                Landed=Nearby;Descending=false;Body.isKinematic=true;
            }
        }
    }
}
