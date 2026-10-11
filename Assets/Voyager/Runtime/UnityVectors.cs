using UnityEngine;
using Voyager.Core;

namespace Voyager
{
    public static class UnityVectors
    {
        public static Vector3 Float(this Double3 v) => new Vector3((float)v.x,(float)v.y,(float)v.z);
        public static Double3 Double(this Vector3 v) => new Double3(v.x,v.y,v.z);
    }
}
