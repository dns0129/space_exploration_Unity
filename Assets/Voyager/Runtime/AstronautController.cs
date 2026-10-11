using UnityEngine;
using Voyager.Core;

namespace Voyager
{
    public sealed class AstronautController : MonoBehaviour
    {
        public float walkSpeed=2.8f,runSpeed=5.5f,jumpSpeed=4.5f;
        public float airControl=.2f,slopeLimit=50;
        public bool Active {get;private set;}
        public bool Grounded {get;private set;}
        public Rigidbody Body {get;private set;}
        public Double3 Position=>ship.Origin+Body.position.Double();
        ShipController ship;
        WorldCatalog world;
        Vector2 move;
        float turn;
        bool running,jumpQueued;
        public void Initialize(ShipController vessel,WorldCatalog catalog)
        {
            ship=vessel;world=catalog;
            Body=gameObject.AddComponent<Rigidbody>();Body.mass=90;Body.useGravity=false;
            Body.constraints=RigidbodyConstraints.FreezeRotation;Body.collisionDetectionMode=CollisionDetectionMode.ContinuousDynamic;
            Body.solverIterations=12;Body.solverVelocityIterations=6;
            CapsuleCollider capsule=gameObject.AddComponent<CapsuleCollider>();capsule.radius=.25f;capsule.height=1.8f;
            capsule.sharedMaterial=new PhysicMaterial("Suit contact") {dynamicFriction=.6f,staticFriction=.8f,bounciness=0};
            ship.OriginShifted+=ShiftOrigin;
            gameObject.SetActive(false);
        }
        public void ReadInput()
        {
            if(!Active) return;
            move=new Vector2((Input.GetKey(KeyCode.D)?1:0)-(Input.GetKey(KeyCode.A)?1:0),(Input.GetKey(KeyCode.W)?1:0)-(Input.GetKey(KeyCode.S)?1:0));
            move=Vector2.ClampMagnitude(move,1);
            turn=(Input.GetKey(KeyCode.RightArrow)?1:0)-(Input.GetKey(KeyCode.LeftArrow)?1:0);
            running=Input.GetKey(KeyCode.LeftShift)||Input.GetKey(KeyCode.RightShift);
            jumpQueued|=Input.GetKeyDown(KeyCode.Space);
        }
        public bool Toggle()
        {
            if(!Active)
            {
                if(ship.Landed==null) return false;
                Vector3 up=(ship.Position-ship.Landed.positionM).Normalized.Float();
                Double3 direction=(ship.Position-ship.Landed.positionM+(ship.Body.rotation*Vector3.right*9).Double()).Normalized;
                Double3 feet=ship.Landed.positionM+direction*(world.Surface.Radius(ship.Landed,direction)+.02);
                ship.RefreshWalkingTerrain(feet,true);
                gameObject.SetActive(true);Body.position=(feet-ship.Origin).Float()+up*.9f;
                Body.rotation=Quaternion.LookRotation(Vector3.ProjectOnPlane(ship.Body.rotation*Vector3.forward,up).normalized,up);
                Body.velocity=Vector3.zero;Active=true;ship.Walking=true;jumpQueued=false;Grounded=false;
                Physics.SyncTransforms();return true;
            }
            if(!Grounded || (Position-ship.Position).Magnitude>12) return false;
            Active=false;ship.Walking=false;gameObject.SetActive(false);ship.RefreshFlightTerrain();return true;
        }
        public void Tick(float dt)
        {
            if(!Active) return;
            ship.RefreshWalkingTerrain(Position);
            Double3 radial=Position-ship.Landed.positionM;
            Vector3 up=radial.Normalized.Float();
            Vector3 forward=Vector3.ProjectOnPlane(Body.rotation*Vector3.forward,up).normalized;
            forward=Quaternion.AngleAxis(turn*90*dt,up)*forward;
            Body.rotation=Quaternion.LookRotation(forward,up);
            Grounded=Physics.SphereCast(Body.position,.24f,-up,out RaycastHit hit,.69f,1<<8,QueryTriggerInteraction.Ignore)
                && Vector3.Dot(hit.normal,up)>=Mathf.Cos(slopeLimit*Mathf.Deg2Rad)
                && Vector3.Dot(Body.velocity,up)<.2f;
            double natural=PhysicsMath.Gravity(radial,ship.Landed.radiusM,ship.Landed.gravity).Magnitude;
            // Match the original suit's minimum fall acceleration on very small moons.
            float gravity=(float)System.Math.Max(.35,natural);
            Body.AddForce(-up*gravity,ForceMode.Acceleration);
            Vector3 desired=(forward*move.y+Vector3.Cross(up,forward)*move.x)*(running?runSpeed:walkSpeed);
            Vector3 tangent=Vector3.ProjectOnPlane(Body.velocity,up);
            Body.AddForce((desired-tangent)*(Grounded?12:12*airControl),ForceMode.Acceleration);
            if(jumpQueued && Grounded)
            {
                Body.velocity=Vector3.ProjectOnPlane(Body.velocity,up)+up*jumpSpeed;
                Grounded=false;
            }
            jumpQueued=false;
        }
        public void TickAfter() {if(Active) ship.Rebase(Body.position);}
        public void ResetToShip() {Active=false;ship.Walking=false;gameObject.SetActive(false);}
        public bool Restore(Double3 position,Vector3 velocity,Quaternion orientation)
        {
            if(ship.Landed==null || !position.IsFinite || !velocity.Double().IsFinite || (position-ship.Position).Magnitude>10000 || velocity.magnitude>100) return false;
            double height=world.Surface.Altitude(ship.Landed,position-ship.Landed.positionM);
            if(height<.75 || height>1000) return false;
            float length=orientation.x*orientation.x+orientation.y*orientation.y+orientation.z*orientation.z+orientation.w*orientation.w;
            if(float.IsNaN(length)||float.IsInfinity(length)||length<.9f||length>1.1f) return false;
            ship.RefreshWalkingTerrain(position,true);gameObject.SetActive(true);
            Body.position=(position-ship.Origin).Float();Body.rotation=orientation.normalized;Body.velocity=velocity;
            Active=true;ship.Walking=true;jumpQueued=false;Grounded=false;Physics.SyncTransforms();return true;
        }
        void ShiftOrigin(Vector3 shift) {if(Active) Body.position-=shift;}
        void OnDestroy() {if(ship!=null) ship.OriginShifted-=ShiftOrigin;}
    }
}
