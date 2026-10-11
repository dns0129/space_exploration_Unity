using System;

namespace Voyager.Core
{
    [Serializable]
    public struct Double3
    {
        public double x, y, z;
        public Double3(double x, double y, double z) { this.x = x; this.y = y; this.z = z; }
        public static Double3 Zero => new Double3();
        public double SqrMagnitude => x * x + y * y + z * z;
        public double Magnitude => Math.Sqrt(SqrMagnitude);
        public bool IsFinite => !double.IsNaN(x) && !double.IsInfinity(x) && !double.IsNaN(y) && !double.IsInfinity(y) && !double.IsNaN(z) && !double.IsInfinity(z);
        public Double3 Normalized => Magnitude > 1e-15 ? this / Magnitude : Zero;
        public static Double3 operator +(Double3 a, Double3 b) => new Double3(a.x+b.x,a.y+b.y,a.z+b.z);
        public static Double3 operator -(Double3 a, Double3 b) => new Double3(a.x-b.x,a.y-b.y,a.z-b.z);
        public static Double3 operator -(Double3 a) => a * -1;
        public static Double3 operator *(Double3 a, double k) => new Double3(a.x*k,a.y*k,a.z*k);
        public static Double3 operator /(Double3 a, double k) => a * (1/k);
        public static double Dot(Double3 a, Double3 b) => a.x*b.x+a.y*b.y+a.z*b.z;
        public static Double3 Cross(Double3 a, Double3 b) => new Double3(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
        public static Double3 Lerp(Double3 a, Double3 b, double t) => a+(b-a)*t;
        public override string ToString() => $"({x:R}, {y:R}, {z:R})";
    }
}
