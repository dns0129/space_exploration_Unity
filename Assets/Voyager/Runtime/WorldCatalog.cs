using System.IO;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using Voyager.Core;

namespace Voyager
{
    public sealed class WorldCatalog
    {
        public WorldData Data { get; }
        public SurfaceSampler Surface { get; }
        public WorldCatalog()
        {
            string folder=Path.Combine(Application.streamingAssetsPath,"Voyager");
            Data=JsonUtility.FromJson<WorldData>(File.ReadAllText(Path.Combine(folder,"world.json")));
            Surface=new SurfaceSampler(file=>File.ReadAllBytes(Path.Combine(folder,"Terrain",file)));
        }
        WorldCatalog(WorldData data,Dictionary<string,byte[]> terrain)
        {
            Data=data;Surface=new SurfaceSampler(file=>terrain[file]);
        }
        // StreamingAssets is an HTTP URL in WebGL, not a readable local directory.
        public static IEnumerator LoadBrowser(Action<WorldCatalog> loaded,Action<string> failed)
        {
            string folder=Application.streamingAssetsPath.TrimEnd('/')+"/Voyager/";
            WorldData data;
            using(var request=UnityWebRequest.Get(folder+"world.json"))
            {
                request.timeout=30;yield return request.SendWebRequest();
                if(request.result!=UnityWebRequest.Result.Success) {failed("世界数据下载失败："+request.error);yield break;}
                try
                {
                    data=JsonUtility.FromJson<WorldData>(request.downloadHandler.text);
                    if(data?.bodies==null || data.systems==null) throw new InvalidDataException("世界数据无效");
                }
                catch(Exception error) {failed(error.Message);yield break;}
            }
            var terrain=new Dictionary<string,byte[]>();
            foreach(BodyData body in data.bodies)
            {
                var map=body.terrain;
                if(map==null || terrain.ContainsKey(map.file)) continue;
                using(var request=UnityWebRequest.Get(folder+"Terrain/"+Uri.EscapeDataString(map.file)))
                {
                    request.timeout=30;yield return request.SendWebRequest();
                    if(request.result!=UnityWebRequest.Result.Success) {failed("地形下载失败："+map.file+" · "+request.error);yield break;}
                    byte[] bytes=request.downloadHandler.data;
                    if(bytes.Length!=map.width*map.height) {failed("地形数据长度无效："+map.file);yield break;}
                    terrain.Add(map.file,bytes);
                }
            }
            loaded(new WorldCatalog(data,terrain));
        }
        public BodyData Find(string id) => System.Array.Find(Data.bodies,b=>b.id==id);
        public BodyData Nearest(string system,Double3 position)
        {
            BodyData result=null; double minimum=double.PositiveInfinity;
            foreach(BodyData b in Data.bodies)
            {
                if(b.systemId!=system || b.kind=="station") continue;
                double altitude=(position-b.positionM).Magnitude-b.radiusM;
                if(altitude<minimum) {minimum=altitude;result=b;}
            }
            return result;
        }
    }
}
