using System;

namespace Voyager.Core
{
    [Serializable] public sealed class WorldData { public string sourceCommit; public SystemData[] systems; public BodyData[] bodies; }
    [Serializable] public sealed class SystemData { public string id, name, primaryStar; }
    [Serializable] public sealed class TerrainData
    {
        public string file;
        public int width, height;
        public double offsetM, scaleM, tilt, yaw, mapOffset;
        public bool fine;
    }
    [Serializable] public sealed class BodyData
    {
        public string id, name, systemId, kind, parentId, color, texture;
        public Double3 positionM;
        public double radiusM, gravity, density, scaleHeightM, atmosphereM;
        public bool solid;
        public TerrainData terrain;
        public double Mu => gravity * radiusM * radiusM;
    }
}
