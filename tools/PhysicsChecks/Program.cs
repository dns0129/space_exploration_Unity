using System;
using System.IO;
using System.Text.Json;
using Voyager.Core;

static class Program
{
    public sealed class Fixture { public string id=""; public Double3 normal=Double3.Zero; public double heightM=0; }
    static int assertions;
    static void Check(bool condition,string message) {assertions++;if(!condition)throw new Exception(message);}
    static void Main(string[] args)
    {
        string root=Path.GetFullPath(args.Length>0?args[0]:".");
        var options=new JsonSerializerOptions {IncludeFields=true};
        var world=JsonSerializer.Deserialize<WorldData>(File.ReadAllText(Path.Combine(root,"Assets/StreamingAssets/Voyager/world.json")),options);
        var samples=JsonSerializer.Deserialize<Fixture[]>(File.ReadAllText(Path.Combine(root,"tools/PhysicsChecks/terrain-fixtures.json")),options);
        var terrain=new SurfaceSampler(file=>File.ReadAllBytes(Path.Combine(root,"Assets/StreamingAssets/Voyager/Terrain",file)));
        Check(world.bodies.Length==56,"All 56 destinations must be retained");
        double maxError=0;
        foreach(var fixture in samples)
        {
            BodyData body=Array.Find(world.bodies,b=>b.id==fixture.id);
            double value=terrain.Height(body,fixture.normal);
            double error=Math.Abs(value-fixture.heightM);maxError=Math.Max(maxError,error);
            Check(error<.001,"Canonical terrain differs from web version at "+body.id+": "+error);
        }
        var earth=Array.Find(world.bodies,b=>b.id=="earth");
        var moon=Array.Find(world.bodies,b=>b.id=="moon");
        Check(Math.Abs(PhysicsMath.Gravity(new Double3(0,earth.radiusM,0),earth.radiusM,earth.gravity).Magnitude-9.81)<1e-9,"Earth surface gravity");
        Check(Math.Abs(PhysicsMath.Gravity(new Double3(0,earth.radiusM*2,0),earth.radiusM,earth.gravity).Magnitude-9.81/4)<1e-9,"Inverse square gravity");
        Check(Math.Abs(PhysicsMath.Gravity(new Double3(0,moon.radiusM,0),moon.radiusM,moon.gravity).Magnitude-1.62)<1e-9,"Moon gravity");
        Check(4.5*4.5/(2*moon.gravity)>4.5*4.5/(2*earth.gravity),"Low gravity jump must be higher");
        Check(PhysicsMath.SweepSphere(new Double3(-1e8,0,0),new Double3(1e8,0,0),Double3.Zero,6371000,out double entry),"Fast movement crosses Earth even when both endpoints are outside");
        Check(Math.Abs(entry-(1e8-6371000)/2e8)<1e-10,"Earliest collision fraction");
        Check(!PhysicsMath.SweepSphere(new Double3(-1e8,1e7,0),new Double3(1e8,1e7,0),Double3.Zero,6371000,out _),"Clear path must not collide");
        Check(!PhysicsMath.SweepSphere(new Double3(1e7,0,0),new Double3(2e7,0,0),Double3.Zero,6371000,out _),"Movement away must not collide");
        Check(PhysicsMath.SweepSphere(Double3.Zero,new Double3(1,0,0),Double3.Zero,6371000,out double inside)&&inside==0,"Starts inside a safety sphere");
        for(int i=0;i<=5;i++) Check(PhysicsMath.SliderToSpeed(i)==new[]{1d,100,1000,10000,50000,150000}[i],"Propulsion band boundary "+i);
        var velocity=PhysicsMath.ApproachVelocity(Double3.Zero,new Double3(100,0,0),10,.5);
        Check(Math.Abs(velocity.x-5)<1e-9,"Thrust cannot jump immediately to requested cruise speed");
        Check(PhysicsMath.Density(1,0,8500,160000)==1,"Sea-level atmospheric density");
        Check(PhysicsMath.Density(1,160000,8500,160000)==0,"No atmospheric drag above the atmosphere");
        Double3 origin=new Double3(4.5e12,0,0),local=new Double3(.01,0,0),shift=new Double3(1024,0,0);
        Double3 before=origin+local,after=(origin+shift)+(local-shift);
        Check((before-after).Magnitude<.001,"Rebasing must preserve universe position");
        Console.WriteLine($"PASS: {assertions} checks; {samples.Length} original terrain samples, maximum error {maxError:R} m.");
    }
}
