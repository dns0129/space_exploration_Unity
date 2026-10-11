using System.Collections.Generic;
using UnityEngine;
using Voyager.Core;

namespace Voyager
{
    public sealed class VoyagerPresentation : MonoBehaviour
    {
        VoyagerSimulation simulation;
        Camera view;
        Light sunlight;
        Transform shipVisual,walkerVisual;
        readonly Dictionary<string,GameObject> planets=new Dictionary<string,GameObject>();
        readonly HashSet<string> texturesRequested=new HashSet<string>();
        ParticleSystem exhaust;
        Vector2 scroll;
        string menuSystem="solar";
        bool cockpit,photo;
        float slider=1;
        Material starMaterial;
        Font uiFont;
        public static Material Material(Color color,float emission=0)
        {
            Material material=new Material(Resources.Load<Shader>("VoyagerLit"));material.color=color;material.SetFloat("_Emission",emission);return material;
        }
        public void Initialize(VoyagerSimulation owner)
        {
            simulation=owner;
            uiFont=Resources.Load<Font>("VoyagerUI");
            view=new GameObject("Flight camera").AddComponent<Camera>();view.tag="MainCamera";
            view.transform.SetParent(transform,false);
            view.nearClipPlane=.05f;view.farClipPlane=50000;view.backgroundColor=new Color(.003f,.005f,.014f);view.clearFlags=CameraClearFlags.SolidColor;
            view.gameObject.AddComponent<AudioListener>();
            sunlight=new GameObject("Stellar light").AddComponent<Light>();sunlight.type=LightType.Directional;sunlight.intensity=1.4f;
            sunlight.transform.SetParent(transform,false);
            RenderSettings.ambientLight=new Color(.12f,.15f,.2f);
            shipVisual=new GameObject("Shuttle hull").transform;shipVisual.SetParent(owner.Ship.transform,false);
            Material hull=Material(new Color(.22f,.29f,.34f)),edge=Material(new Color(.03f,.8f,1),1.5f);
            Primitive(PrimitiveType.Capsule,shipVisual,new Vector3(0,0,-2),new Vector3(5,10,5),hull).localRotation=Quaternion.Euler(90,0,0);
            Primitive(PrimitiveType.Cube,shipVisual,new Vector3(0,-.8f,-3),new Vector3(18,.5f,8),hull);
            Primitive(PrimitiveType.Cube,shipVisual,new Vector3(0,1.1f,3),new Vector3(3,1,5),edge);
            for(int side=-1;side<=1;side+=2)
                Primitive(PrimitiveType.Cylinder,shipVisual,new Vector3(side*5,0,-7),new Vector3(2,4,2),hull).localRotation=Quaternion.Euler(90,0,0);
            walkerVisual=new GameObject("Suit visual").transform;walkerVisual.SetParent(owner.Astronaut.transform,false);
            Primitive(PrimitiveType.Capsule,walkerVisual,Vector3.zero,new Vector3(.5f,.9f,.5f),Material(new Color(.85f,.9f,.94f)));
            Primitive(PrimitiveType.Sphere,walkerVisual,new Vector3(0,.7f,.1f),new Vector3(.5f,.45f,.5f),edge);
            GameObject flame=new GameObject("Engine particles");flame.transform.SetParent(shipVisual,false);flame.transform.localPosition=new Vector3(0,0,-11);flame.transform.localRotation=Quaternion.Euler(0,180,0);
            exhaust=flame.AddComponent<ParticleSystem>();var main=exhaust.main;main.startLifetime=.18f;main.startSpeed=35;main.startSize=1.3f;main.startColor=new Color(.1f,.7f,1);main.maxParticles=200;
            main.simulationSpace=ParticleSystemSimulationSpace.Local;var emission=exhaust.emission;emission.rateOverTime=0;
            var shape=exhaust.shape;shape.shapeType=ParticleSystemShapeType.Cone;shape.angle=8;shape.radius=.7f;
            flame.GetComponent<ParticleSystemRenderer>().sharedMaterial=new Material(Resources.Load<Shader>("VoyagerParticles"));
            starMaterial=Material(new Color(.7f,.8f,1),1);
            Random.State original=Random.state;Random.InitState(129);
            Transform stars=new GameObject("Star field").transform;
            stars.SetParent(transform,false);
            for(int i=0;i<260;i++) Primitive(PrimitiveType.Sphere,stars,Random.onUnitSphere*38000,Vector3.one*Random.Range(5,20),starMaterial);
            Random.state=original;
        }
        static Transform Primitive(PrimitiveType type,Transform parent,Vector3 position,Vector3 scale,Material material)
        {
            GameObject obj=GameObject.CreatePrimitive(type);Collider collider=obj.GetComponent<Collider>();if(collider!=null) {collider.enabled=false;Destroy(collider);}
            obj.transform.SetParent(parent,false);obj.transform.localPosition=position;obj.transform.localScale=scale;obj.GetComponent<Renderer>().sharedMaterial=material;
            return obj.transform;
        }
        void LateUpdate()
        {
            ShipController ship=simulation.Ship;AstronautController walker=simulation.Astronaut;
            if(Input.GetKeyDown(KeyCode.C)) cockpit=!cockpit;
            if(Input.GetKeyDown(KeyCode.P)) photo=!photo;
            if(photo && Input.GetKeyDown(KeyCode.Return)) StartCoroutine(VoyagerBrowser.CapturePhoto());
            Transform focus=walker.Active?walker.transform:ship.transform;
            Vector3 up=focus.up;
            Vector3 offset=walker.Active?(cockpit?new Vector3(0,.7f,.15f):new Vector3(0,1.4f,-4)):(cockpit?new Vector3(0,2,5):new Vector3(0,8,-35));
            Vector3 desired=focus.TransformPoint(offset);
            if(walker.Active && !cockpit)
            {
                Vector3 start=focus.position+up*.6f,delta=desired-start;
                if(Physics.SphereCast(start,.2f,delta.normalized,out RaycastHit hit,delta.magnitude,1<<8)) desired=start+delta.normalized*Mathf.Max(.2f,hit.distance-.05f);
            }
            view.transform.position=desired;view.transform.rotation=focus.rotation;
            view.fieldOfView=Mathf.Lerp(view.fieldOfView,ship.Warping?85:cockpit?70:60,1-Mathf.Exp(-Time.unscaledDeltaTime*4));
            shipVisual.gameObject.SetActive(!cockpit||walker.Active);walkerVisual.gameObject.SetActive(!cockpit);
            var emission=exhaust.emission;emission.rateOverTime=simulation.Paused?0:ship.Thrust*120;
            if(simulation.Paused && exhaust.isPlaying) exhaust.Pause();else if(!simulation.Paused && exhaust.isPaused) exhaust.Play();
            Double3 eye=walker.Active?walker.Position:ship.Position;
            foreach(BodyData b in simulation.World.Data.bodies)
            {
                bool visible=b.systemId==ship.systemId && !(ship.LocalPhysics && b==ship.Nearby);
                if(!visible) {if(planets.TryGetValue(b.id,out GameObject hidden)) hidden.SetActive(false);continue;}
                if(!planets.TryGetValue(b.id,out GameObject planet))
                {
                    ColorUtility.TryParseHtmlString(b.color,out Color color);
                    Material material=Material(b.kind=="black-hole"?Color.black:color,b.kind=="star"?1:0);
                    planet=Primitive(b.kind=="station"?PrimitiveType.Cube:PrimitiveType.Sphere,transform,Vector3.zero,Vector3.one,material).gameObject;
                    planet.name=b.name;planets.Add(b.id,planet);
                }
                planet.SetActive(true);
                Double3 relative=b.positionM-eye;double distance=relative.Magnitude;
                if(distance>1 && b.radiusM/distance>.002 && !texturesRequested.Contains(b.id))
                {
                    texturesRequested.Add(b.id);
                    Texture2D map=Resources.Load<Texture2D>("CelestialTextures/"+b.texture);
                    if(map!=null) {Material material=planet.GetComponent<Renderer>().sharedMaterial;material.mainTexture=map;material.color=Color.white;}
                }
                double renderDistance=System.Math.Min(28000,distance/1000);
                double scale=distance>1?renderDistance/distance:0;
                planet.transform.position=view.transform.position+relative.Normalized.Float()*(float)renderDistance;
                planet.transform.localScale=Vector3.one*(float)(b.radiusM*2*scale);
            }
            BodyData sun=simulation.World.Find(System.Array.Find(simulation.World.Data.systems,s=>s.id==ship.systemId).primaryStar);
            if(sun!=null) sunlight.transform.rotation=Quaternion.LookRotation((eye-sun.positionM).Normalized.Float(),Vector3.up);
        }
        void OnGUI()
        {
            if(photo) return;
            if(uiFont!=null) GUI.skin.font=uiFont;
            ShipController ship=simulation.Ship;AstronautController walker=simulation.Astronaut;
            float scale=Mathf.Clamp(Screen.width/1400f,.65f,1.4f);GUI.matrix=Matrix4x4.Scale(new Vector3(scale,scale,1));
            GUILayout.BeginArea(new Rect(20,20,340,Screen.height/scale-40),GUI.skin.box);
            GUILayout.Label("星际探索 · VOYAGER UNITY");
            GUILayout.Label(simulation.Paused?"已暂停 · Esc 继续":walker.Active?"地表徒步":ship.Landed!=null?"已着陆":"自由航行");
            if(GUILayout.Button(simulation.Paused?"继续航行":"暂停航行")) simulation.TogglePause();
            GUILayout.Label($"速度 {ship.Velocity.Magnitude/1000:0.000} km/s · 跃迁 {ship.WarpStatus}");
            if(ship.Nearby!=null)
            {
                Double3 position=walker.Active?walker.Position:ship.Position;
                GUILayout.Label($"{ship.Nearby.name} · 高度 {simulation.World.Surface.Altitude(ship.Nearby,position-ship.Nearby.positionM):0.0} m");
                GUILayout.Label($"地表重力 {ship.Nearby.gravity:0.000} m/s²");
            }
            GUILayout.Label("W/S 推力 · A/D 平移 · R/F 升降\n方向键转向 · Q/E 翻滚 · Shift 加速\n空格刹车/跳跃 · C 视角 · G 辅助\nL 着陆/起飞 · E 离舱/返舱 · J 跃迁\nT 对准目标 · Esc 暂停 · P 摄影");
            GUI.enabled=!simulation.Paused && !walker.Active && !ship.Warping;
            if(ship.LocalPhysics)
            {
                GUILayout.Label($"低空目标速度 {ship.surfaceSpeedMps:0} m/s");
                ship.surfaceSpeedMps=GUILayout.HorizontalSlider(ship.surfaceSpeedMps,1,1000);
            }
            else
            {
                GUILayout.Label($"太空目标速度 {ship.cruiseSpeedKm:0} km/s");
                slider=SpeedToSlider(ship.cruiseSpeedKm);
                slider=GUILayout.HorizontalSlider(slider,0,5);ship.cruiseSpeedKm=PhysicsMath.SliderToSpeed(slider);
            }
            if(GUILayout.Button(ship.assist?"驾驶辅助：开启":"驾驶辅助：关闭")) ship.assist=!ship.assist;
            if(GUILayout.Button("对准目标")) ship.AlignToTarget();
            if(GUILayout.Button("启动跃迁")) simulation.Notify(ship.StartWarp()?"跃迁蓄能开始":"当前无法跃迁");
            if(GUILayout.Button(ship.Landed!=null?"起飞":"自动着陆（地表 10 km 内）")) ship.ToggleLanding();
            GUI.enabled=!simulation.Paused;
            if(ship.Landed!=null && GUILayout.Button(walker.Active?"返回飞船":"离开飞船")) walker.Toggle();
            GUI.enabled=true;
            GUILayout.BeginHorizontal();
#if UNITY_WEBGL && !UNITY_EDITOR
            if(GUILayout.Button("保存 K"))simulation.Save();if(GUILayout.Button("恢复 O")) {simulation.Load();slider=SpeedToSlider(ship.cruiseSpeedKm);}
#else
            if(GUILayout.Button("保存 F5"))simulation.Save();if(GUILayout.Button("恢复 F9")) {simulation.Load();slider=SpeedToSlider(ship.cruiseSpeedKm);}
#endif
            GUILayout.EndHorizontal();
            GUILayout.Label(simulation.Message);
            scroll=GUILayout.BeginScrollView(scroll);
            foreach(SystemData system in simulation.World.Data.systems) if(GUILayout.Button(system.name))menuSystem=system.id;
            GUILayout.Space(8);
            foreach(BodyData b in simulation.World.Data.bodies)
                if(b.systemId==menuSystem && GUILayout.Button((ship.targetId==b.id?"● ":"")+b.name))ship.targetId=b.id;
            BodyData target=simulation.World.Find(ship.targetId);
            GUI.enabled=!walker.Active && !ship.Warping && !simulation.Paused;
            if(GUILayout.Button("快速抵达目标附近")) {walker.ResetToShip();ship.JumpTo(target);}
            if(target.solid && GUILayout.Button("从目标地表出发")) {walker.ResetToShip();ship.PlaceOnSurface(target);}
            GUI.enabled=true;
            GUILayout.EndScrollView();GUILayout.EndArea();
        }
        static float SpeedToSlider(double speed)
        {
            double[] bands={1,100,1000,10000,50000,150000};
            for(int i=0;i<5;i++) if(speed<=bands[i+1]) return i+(float)((speed-bands[i])/(bands[i+1]-bands[i]));
            return 5;
        }
    }
}
