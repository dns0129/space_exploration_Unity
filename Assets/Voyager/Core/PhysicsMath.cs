using System;

namespace Voyager.Core
{
    public static class PhysicsMath
    {
        public static double Clamp(double v, double lo, double hi) => Math.Max(lo, Math.Min(hi, v));
        public static Double3 Gravity(Double3 radial, double radius, double surfaceGravity)
        {
            double distance = radial.Magnitude;
            if (distance < 1e-12) return Double3.Zero;
            return radial * (-surfaceGravity * Math.Pow(radius / Math.Max(radius, distance), 2) / distance);
        }
        public static double Density(double surfaceDensity, double height, double scaleHeight, double atmosphereHeight)
            => height >= atmosphereHeight || atmosphereHeight <= 0 ? 0 : surfaceDensity * Math.Exp(-Math.Max(0,height)/Math.Max(1,scaleHeight));
        // Analytic entry prevents astronomical cruise motion skipping an entire body between ticks.
        public static bool SweepSphere(Double3 from, Double3 to, Double3 center, double radius, out double fraction)
        {
            Double3 offset = from-center, delta = to-from;
            double c = offset.SqrMagnitude-radius*radius;
            fraction = 0;
            if (c <= 0) return true;
            double a=delta.SqrMagnitude;
            if (a < 1e-20) return false;
            double b=Double3.Dot(offset,delta), discriminant=b*b-a*c;
            if (b >= 0 || discriminant < 0) return false;
            fraction = c / (-b+Math.Sqrt(discriminant));
            return fraction >= 0 && fraction <= 1;
        }
        public static double SliderToSpeed(double slider)
        {
            double[] bands={1,100,1000,10000,50000,150000};
            double v=Clamp(slider,0,5); int band=Math.Min(4,(int)v);
            return bands[band]+(bands[band+1]-bands[band])*(v-band);
        }
        public static Double3 ApproachVelocity(Double3 velocity, Double3 desired, double acceleration, double dt)
        {
            Double3 change=desired-velocity; double length=change.Magnitude;
            return velocity+change*(length>0?Math.Min(1,acceleration*dt/length):0);
        }
    }
}
