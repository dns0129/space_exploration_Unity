using System;
using System.Collections.Generic;

namespace Voyager.Core
{
    public sealed class SurfaceSampler
    {
        readonly Dictionary<string,byte[]> rasters = new Dictionary<string,byte[]>();
        readonly Func<string,byte[]> loader;
        public SurfaceSampler(Func<string,byte[]> loader) { this.loader=loader; }
        public double Height(BodyData body, Double3 normal)
        {
            if (!body.solid) return 0;
            normal=normal.Normalized;
            TerrainData t=body.terrain;
            if (t==null || string.IsNullOrEmpty(t.file)) return LegacyHeight(body.id,normal);
            if (!rasters.TryGetValue(t.file,out byte[] data))
            {
                data=loader(t.file);
                if (data.Length!=t.width*t.height) throw new InvalidOperationException("Invalid terrain raster: "+t.file);
                rasters.Add(t.file,data);
            }
            double yaw=-t.yaw+t.mapOffset*Math.PI*2;
            double tx=Math.Cos(t.tilt)*normal.x+Math.Sin(t.tilt)*normal.y;
            double ty=-Math.Sin(t.tilt)*normal.x+Math.Cos(t.tilt)*normal.y;
            double mx=Math.Cos(yaw)*tx+Math.Sin(yaw)*normal.z, mz=-Math.Sin(yaw)*tx+Math.Cos(yaw)*normal.z;
            double u=Math.Atan2(mz,-mx)/(Math.PI*2); u-=Math.Floor(u);
            double v=.5+Math.Asin(PhysicsMath.Clamp(ty,-1,1))/Math.PI;
            double x=u*t.width-.5,y=PhysicsMath.Clamp(v*t.height-.5,0,t.height-1);
            int ix=(int)Math.Floor(x),iy=(int)Math.Floor(y),north=Math.Min(iy+1,t.height-1);
            int west=(ix%t.width+t.width)%t.width,east=(west+1)%t.width;
            double a=data[iy*t.width+west],b=data[iy*t.width+east],c=data[north*t.width+west],d=data[north*t.width+east];
            double value=((a+(b-a)*(x-ix))*(1-(y-iy))+(c+(d-c)*(x-ix))*(y-iy))/255;
            return t.offsetM+value*t.scaleM+(t.fine?LegacyHeight(body.id,normal)-65:0);
        }
        public double Radius(BodyData b, Double3 radial) => b.radiusM+Height(b,radial);
        public double Altitude(BodyData b, Double3 radial) => radial.Magnitude-Radius(b,radial);
        public double MaxHeight(BodyData b) => b.terrain!=null ? b.terrain.offsetM+b.terrain.scaleM+(b.terrain.fine?54:0) : b.solid? 5200:0;
        static double LegacyHeight(string id, Double3 n)
        {
            double x=n.x,y=n.y,z=n.z;
            if(id=="earth")
            {
                double region=Noise(x*38+7,y*38-3,z*38+11),warp=Noise(x*110,y*110,z*110)*2;
                double ridge=1-Math.Abs(Noise(x*260+warp,y*260-warp,z*260+17)*2-1);
                double shoulder=Noise(x*620+31,y*620,z*620-9),detail=Noise(x*1800,y*1800+5,z*1800);
                return (0.06+PhysicsMath.Clamp((region-.28)/.42,0,1)*(.25+4.6*Math.Pow(ridge,3))+shoulder*.22+detail*.045)*1000;
            }
            double seed=0; foreach(char c in id) seed+=c; seed*=.17;
            return 65+Math.Sin(x*1900+seed)*Math.Sin(y*1700-seed)*Math.Cos(z*2100)*45
                +Math.Sin(x*7200+y*3600+seed)*Math.Cos(z*6400-y*3200)*9;
        }
        static double Hash(double a,double b,double c) { double n=Math.Sin(a*127.1+b*311.7+c*74.7)*43758.5453; return n-Math.Floor(n); }
        static double Mix(double a,double b,double t)=>a+(b-a)*t;
        static double Smooth(double t)=>t*t*(3-2*t);
        static double Noise(double x,double y,double z)
        {
            double a=Math.Floor(x),b=Math.Floor(y),c=Math.Floor(z),tx=Smooth(x-a),ty=Smooth(y-b),tz=Smooth(z-c);
            return Mix(Mix(Mix(Hash(a,b,c),Hash(a+1,b,c),tx),Mix(Hash(a,b+1,c),Hash(a+1,b+1,c),tx),ty),
                Mix(Mix(Hash(a,b,c+1),Hash(a+1,b,c+1),tx),Mix(Hash(a,b+1,c+1),Hash(a+1,b+1,c+1),tx),ty),tz);
        }
    }
}
