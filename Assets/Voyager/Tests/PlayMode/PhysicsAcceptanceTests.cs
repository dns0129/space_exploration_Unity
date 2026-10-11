using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Voyager.Core;

namespace Voyager.Tests
{
    public sealed class PhysicsAcceptanceTests
    {
        [UnityTest]
        public IEnumerator ShuttleSurfaceExitJumpAndSaveRestore()
        {
            var root=new GameObject("Acceptance test");
            var simulation=root.AddComponent<VoyagerSimulation>();
            var ship=simulation.Ship;var walker=simulation.Astronaut;
            ship.PlaceOnSurface(simulation.World.Find("moon"));
            Assert.IsNotNull(ship.Landed);
            Assert.IsTrue(walker.Toggle());
            for(int i=0;i<30;i++) yield return null;
            Assert.IsTrue(walker.Grounded,"PhysX capsule must rest on the rendered triangle mesh");
            Double3 start=walker.Position;
            Vector3 up=(start-ship.Landed.positionM).Normalized.Float();
            walker.Body.velocity=up*walker.jumpSpeed;
            double highest=0;
            for(int i=0;i<120;i++) {yield return null;highest=System.Math.Max(highest,Double3.Dot(walker.Position-start,up.Double()));}
            Assert.Greater(highest,1,"Moon jump must leave the terrain");
            Double3 previousVelocity=ship.Velocity;
            ship.Rebase(new Vector3(1200,0,0));
            Assert.Less((ship.Velocity-previousVelocity).Magnitude,.0001);
            Double3 saved=walker.Position;
            simulation.Save();
            walker.Body.position+=Vector3.right*3;
            simulation.Load();
            Assert.IsTrue(walker.Active);
            Assert.Less((walker.Position-saved).Magnitude,.001,"Saving must retain local precision after rebasing");
            Object.Destroy(root);
            yield return null;
        }
    }
}
