using System.IO;
using UnityEngine;
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
