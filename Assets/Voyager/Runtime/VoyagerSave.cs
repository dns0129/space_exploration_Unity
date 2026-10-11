using System;
using System.IO;
using UnityEngine;
using Voyager.Core;

namespace Voyager
{
    public static class VoyagerSave
    {
        [Serializable] sealed class State
        {
            public int version=1;
            public string systemId,targetId,landedId;
            public Double3 position,velocity,walkerPosition;
            public Quaternion rotation,walkerRotation;
            public Vector3 walkerVelocity;
            public bool assist,walking;
            public double cruiseSpeedKm;
        }
        static string Filename=>Path.Combine(Application.persistentDataPath,"voyager-unity.json");
        const string BrowserKey="voyager-unity-save-v1";
        public static void Save(ShipController ship,AstronautController astronaut)
        {
            State state=new State {systemId=ship.systemId,targetId=ship.targetId,landedId=ship.Landed?.id,
                position=ship.Position,velocity=ship.Velocity,rotation=ship.Body.rotation,assist=ship.assist,
                cruiseSpeedKm=ship.cruiseSpeedKm,walking=astronaut.Active};
            if(state.walking) {state.walkerPosition=astronaut.Position;state.walkerRotation=astronaut.Body.rotation;state.walkerVelocity=astronaut.Body.velocity;}
            string json=JsonUtility.ToJson(state,true);
#if UNITY_WEBGL && !UNITY_EDITOR
            PlayerPrefs.SetString(BrowserKey,json);PlayerPrefs.Save();
#else
            string temporary=Filename+".tmp";
            File.WriteAllText(temporary,json);
            if(File.Exists(Filename)) File.Replace(temporary,Filename,Filename+".bak");else File.Move(temporary,Filename);
#endif
        }
        public static bool Load(ShipController ship,AstronautController astronaut)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if(!PlayerPrefs.HasKey(BrowserKey)) return false;
            string json=PlayerPrefs.GetString(BrowserKey);
#else
            if(!File.Exists(Filename)) return false;
            string json=File.ReadAllText(Filename);
#endif
            State s=JsonUtility.FromJson<State>(json);
            if(s==null || s.version!=1 || double.IsNaN(s.cruiseSpeedKm) || double.IsInfinity(s.cruiseSpeedKm) || s.cruiseSpeedKm<1 || s.cruiseSpeedKm>150000) return false;
            if(s.walking)
            {
                BodyData ground=ship.Catalog.Find(s.landedId);
                if(ground==null || !s.walkerPosition.IsFinite || !s.walkerVelocity.Double().IsFinite || (s.walkerPosition-s.position).Magnitude>10000 || s.walkerVelocity.magnitude>100) return false;
                double height=ship.Catalog.Surface.Altitude(ground,s.walkerPosition-ground.positionM);
                float norm=s.walkerRotation.x*s.walkerRotation.x+s.walkerRotation.y*s.walkerRotation.y+s.walkerRotation.z*s.walkerRotation.z+s.walkerRotation.w*s.walkerRotation.w;
                if(height<.75 || height>1000 || float.IsNaN(norm) || float.IsInfinity(norm) || norm<.9 || norm>1.1) return false;
            }
            // All flight state is validated before any live Rigidbody is changed.
            if(!ship.Restore(s.systemId,s.targetId,s.position,s.velocity,s.rotation,s.assist,s.landedId)) return false;
            astronaut.ResetToShip();ship.cruiseSpeedKm=s.cruiseSpeedKm;
            return !s.walking || astronaut.Restore(s.walkerPosition,s.walkerVelocity,s.walkerRotation);
        }
    }
}
