using UnityEngine;
using UnityEngine.Rendering;
using Voyager.Core;

namespace Voyager
{
    // The exact same vertices feed rendering and PhysX. No independent height clamp for the astronaut.
    public sealed class LocalTerrain : MonoBehaviour
    {
        MeshFilter filter;
        MeshCollider colliderComponent;
        MeshRenderer meshRenderer;
        Mesh mesh;
        Double3 center;
        string bodyId;
        bool walkingPatch;
        public void Initialize(Material material)
        {
            filter=gameObject.AddComponent<MeshFilter>();
            colliderComponent=gameObject.AddComponent<MeshCollider>();
            meshRenderer=gameObject.AddComponent<MeshRenderer>(); meshRenderer.sharedMaterial=material;
            gameObject.layer=8;
        }
        public void Refresh(WorldCatalog world,BodyData body,Double3 position,Double3 origin,bool walking,bool force=false)
        {
            if(body==null || !body.solid) {gameObject.SetActive(false);return;}
            double half=walking?80:16000;
            double threshold=walking?20:3000;
            if(!force && gameObject.activeSelf && bodyId==body.id && walkingPatch==walking && (position-center).Magnitude<threshold) return;
            gameObject.SetActive(true); bodyId=body.id;walkingPatch=walking;
            Double3 up=(position-body.positionM).Normalized;
            center=body.positionM+up*world.Surface.Radius(body,up);
            Double3 right=Double3.Cross(System.Math.Abs(up.y)<.9?new Double3(0,1,0):new Double3(1,0,0),up).Normalized;
            Double3 forward=Double3.Cross(right,up).Normalized;
            const int cells=96;
            Vector3[] vertices=new Vector3[(cells+1)*(cells+1)];
            Vector2[] uv=new Vector2[vertices.Length];
            int[] indices=new int[cells*cells*6];
            for(int z=0;z<=cells;z++) for(int x=0;x<=cells;x++)
            {
                int i=z*(cells+1)+x;
                Double3 normal=(center-body.positionM+right*((double)x/cells*2*half-half)+forward*((double)z/cells*2*half-half)).Normalized;
                Double3 point=body.positionM+normal*world.Surface.Radius(body,normal);
                vertices[i]=(point-center).Float();
                uv[i]=new Vector2((float)x/cells,(float)z/cells);
            }
            int index=0;
            for(int z=0;z<cells;z++) for(int x=0;x<cells;x++)
            {
                int a=z*(cells+1)+x,b=a+1,c=a+cells+1,d=c+1;
                indices[index++]=a;indices[index++]=c;indices[index++]=b;
                indices[index++]=b;indices[index++]=c;indices[index++]=d;
            }
            colliderComponent.sharedMesh=null;
            if(mesh!=null) Destroy(mesh);
            mesh=new Mesh {name=body.id+" shared surface",indexFormat=IndexFormat.UInt32};
            mesh.vertices=vertices;mesh.uv=uv;mesh.triangles=indices;mesh.RecalculateNormals();mesh.RecalculateBounds();
            filter.sharedMesh=mesh;colliderComponent.sharedMesh=mesh;
            transform.position=(center-origin).Float();
            if(ColorUtility.TryParseHtmlString(body.color,out Color color)) meshRenderer.material.color=color;
            Physics.SyncTransforms();
        }
        public void Shift(Vector3 shift) {transform.position-=shift;}
        void OnDestroy() {if(mesh!=null) Destroy(mesh);}
    }
}
