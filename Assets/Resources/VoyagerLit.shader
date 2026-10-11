Shader "Voyager/Lit"
{
    Properties { _Color ("Color", Color) = (1,1,1,1) _MainTex ("Surface", 2D) = "white" {} _Emission ("Emission", Float) = 0 }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        Pass
        {
            Tags { "LightMode"="ForwardBase" }
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            #include "Lighting.cginc"
            sampler2D _MainTex; float4 _MainTex_ST; fixed4 _Color; float _Emission;
            struct appdata { float4 vertex:POSITION; float3 normal:NORMAL; float2 uv:TEXCOORD0; };
            struct v2f { float4 position:SV_POSITION; float3 normal:TEXCOORD0; float2 uv:TEXCOORD1; };
            v2f vert(appdata v) { v2f o; o.position=UnityObjectToClipPos(v.vertex);o.normal=UnityObjectToWorldNormal(v.normal);o.uv=TRANSFORM_TEX(v.uv,_MainTex);return o; }
            fixed4 frag(v2f i):SV_Target
            {
                fixed3 baseColor=tex2D(_MainTex,i.uv).rgb*_Color.rgb;
                float light=max(0,dot(normalize(i.normal),normalize(_WorldSpaceLightPos0.xyz)));
                return fixed4(baseColor*(.12+light*_LightColor0.rgb+_Emission),1);
            }
            ENDCG
        }
    }
}
