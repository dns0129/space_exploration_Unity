using System;
using UnityEngine;

namespace Voyager
{
    public sealed class VoyagerSimulation : MonoBehaviour
    {
        public const float TickSeconds=1f/120f;
        public ShipController Ship {get;private set;}
        public AstronautController Astronaut {get;private set;}
        public WorldCatalog World {get;private set;}
        public bool Paused {get;private set;}
        public string Message {get;private set;}="欢迎登舰，选择目的地后按 J 跃迁；靠近地表后按 L 着陆。";
        double accumulator,saveClock;
        bool previousAutoSimulation;
        Vector3 previousGravity;
        bool initialized;
        string loadingMessage="正在加载星图与地形…";
        void Awake()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            StartCoroutine(WorldCatalog.LoadBrowser(Initialize,message=> {loadingMessage=message;VoyagerBrowser.ReportMessage(message);}));
#else
            Initialize(new WorldCatalog());
#endif
        }
        void Initialize(WorldCatalog catalog)
        {
            World=catalog;
            previousAutoSimulation=Physics.autoSimulation;previousGravity=Physics.gravity;
            Physics.autoSimulation=false;Physics.gravity=Vector3.zero;
            Material material=VoyagerPresentation.Material(new Color(.3f,.4f,.5f));
            LocalTerrain terrain=new GameObject("Shared terrain mesh and collider").AddComponent<LocalTerrain>();terrain.Initialize(material);
            terrain.transform.SetParent(transform,false);
            Ship=new GameObject("Voyager shuttle").AddComponent<ShipController>();Ship.Initialize(World,terrain);
            Ship.transform.SetParent(transform,false);
            Astronaut=new GameObject("Astronaut").AddComponent<AstronautController>();Astronaut.Initialize(Ship,World);
            Astronaut.transform.SetParent(transform,false);
            VoyagerPresentation presentation=gameObject.AddComponent<VoyagerPresentation>();presentation.Initialize(this);
            initialized=true;
            VoyagerBrowser.ReportReady();
        }
        void Update()
        {
            if(!initialized) return;
            if(Input.GetKeyDown(KeyCode.Escape)) TogglePause();
#if UNITY_WEBGL && !UNITY_EDITOR
            if(Input.GetKeyDown(KeyCode.K)) Save();
            if(Input.GetKeyDown(KeyCode.O)) Load();
#else
            if(Input.GetKeyDown(KeyCode.F5)) Save();
            if(Input.GetKeyDown(KeyCode.F9)) Load();
#endif
            if(Paused) return;
            if(Input.GetKeyDown(KeyCode.E) && (Ship.Landed!=null || Astronaut.Active))
                Notify(Astronaut.Toggle()?Astronaut.Active?"已离舱":"已返回飞船":"落地并回到飞船 12 米内可返舱");
            Ship.ReadInput();Astronaut.ReadInput();
            accumulator+=Math.Min(.1,Time.unscaledDeltaTime);
            int steps=0;
            while(accumulator>=TickSeconds && steps++<12)
            {
                Ship.TickBefore(TickSeconds);Astronaut.Tick(TickSeconds);
                Physics.Simulate(TickSeconds);
                Ship.TickAfter();Astronaut.TickAfter();
                accumulator-=TickSeconds;saveClock+=TickSeconds;
            }
            if(saveClock>=20 && !Ship.Warping) {Save();saveClock=0;}
        }
        public void TogglePause() {Paused=!Paused;accumulator=0;}
        public void Notify(string message) {Message=message;VoyagerBrowser.ReportMessage(message);}
        public void Save()
        {
            if(!initialized) return;
            try {VoyagerSave.Save(Ship,Astronaut);Notify("航行已保存");}
            catch(Exception error) {Notify("保存失败："+error.Message);Debug.LogException(error);}
        }
        public void Load()
        {
            if(!initialized) return;
            try {Notify(VoyagerSave.Load(Ship,Astronaut)?"已恢复航行":"存档缺失或无效");}
            catch(Exception error) {Notify("恢复失败："+error.Message);Debug.LogException(error);}
        }
        void OnApplicationFocus(bool focused) {if(!focused) {Paused=true;accumulator=0;}}
        void OnGUI()
        {
            if(initialized) return;
            GUI.skin.font=Resources.Load<Font>("VoyagerUI");
            GUI.Box(new Rect(20,20,Mathf.Min(620,Screen.width-40),80),loadingMessage+"\n下载失败时请刷新重试。");
        }
        void OnDestroy()
        {
            if(!initialized) return;
            Physics.autoSimulation=previousAutoSimulation;Physics.gravity=previousGravity;
        }
    }
}
