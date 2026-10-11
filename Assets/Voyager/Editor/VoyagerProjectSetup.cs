using System.IO;
using System;
using System.Diagnostics;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Voyager.Editor
{
    public static class VoyagerProjectSetup
    {
        [MenuItem("Voyager/Open Exploration Scene")]
        public static void OpenScene() {EditorSceneManager.OpenScene("Assets/Voyager/Scenes/Exploration.unity");}
        [MenuItem("Voyager/Rebuild Exploration Scene")]
        public static void CreateScene()
        {
            Scene scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            new GameObject("Voyager simulation").AddComponent<VoyagerSimulation>();
            EditorSceneManager.SaveScene(scene,"Assets/Voyager/Scenes/Exploration.unity");
            EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Voyager/Scenes/Exploration.unity",true)};
            PlayerSettings.companyName="Voyager";PlayerSettings.productName="Space Exploration Unity";
            PlayerSettings.defaultScreenWidth=1600;PlayerSettings.defaultScreenHeight=900;
            AssetDatabase.SaveAssets();
        }
        // UNITY_EDITOR -batchmode -projectPath ... -executeMethod Voyager.Editor.VoyagerProjectSetup.BuildLinux -quit
        public static void BuildLinux()
        {
            Directory.CreateDirectory("Builds/Linux");
            var report=BuildPipeline.BuildPlayer(new[]{"Assets/Voyager/Scenes/Exploration.unity"},"Builds/Linux/Voyager.x86_64",BuildTarget.StandaloneLinux64,BuildOptions.None);
            if(report.summary.result!=UnityEditor.Build.Reporting.BuildResult.Succeeded) throw new System.Exception("Unity player build failed");
        }
        [Serializable] sealed class BrowserBuildInfo
        {
            public string revision,unityVersion,builtAt;
            public bool sourceDirty;
        }
        static string Git(params string[] arguments)
        {
            // Fixed arguments from this class; no shell or user-supplied command text.
            var start=new ProcessStartInfo("git",string.Join(" ",arguments)) {UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true};
            using(var process=Process.Start(start))
            {
                string output=process.StandardOutput.ReadToEnd();string error=process.StandardError.ReadToEnd();process.WaitForExit();
                if(process.ExitCode!=0) throw new Exception("Git metadata unavailable: "+error);
                return output.Trim();
            }
        }
        // GitHub Pages cannot set Unity's gzip/brotli or cross-origin isolation headers.
        [MenuItem("Voyager/Build WebGL for GitHub Pages")]
        public static void BuildWebGL()
        {
            if(!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL,BuildTarget.WebGL))
                throw new Exception("Install WebGL Build Support for Unity 2022.3.62f1 in Unity Hub first.");
            var info=new BrowserBuildInfo {revision=Git("rev-parse","HEAD"),sourceDirty=Git("status","--porcelain").Length!=0,
                unityVersion=Application.unityVersion,builtAt=DateTime.UtcNow.ToString("o")};
            if(info.sourceDirty) throw new Exception("Commit Unity import/source changes before building a publishable WebGL version.");
            PlayerSettings.companyName="Voyager";PlayerSettings.productName="Space Exploration Unity";
            PlayerSettings.WebGL.template="PROJECT:Voyager";
            PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback=false;PlayerSettings.WebGL.threadsSupport=false;
            PlayerSettings.WebGL.dataCaching=true;
            PlayerSettings.WebGL.nameFilesAsHashes=true;
            PlayerSettings.WebGL.initialMemorySize=256;PlayerSettings.WebGL.maximumMemorySize=2048;
            PlayerSettings.WebGL.memoryGrowthMode=WebGLMemoryGrowthMode.Geometric;
            PlayerSettings.WebGL.exceptionSupport=WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.WebGL,ScriptingImplementation.IL2CPP);
            PlayerSettings.SetApiCompatibilityLevel(BuildTargetGroup.WebGL,ApiCompatibilityLevel.NET_Standard_2_0);
            const string output="Builds/WebGL";
            if(Directory.Exists(output)) Directory.Delete(output,true);
            Directory.CreateDirectory(output);
            var report=BuildPipeline.BuildPlayer(new[]{"Assets/Voyager/Scenes/Exploration.unity"},output,BuildTarget.WebGL,BuildOptions.None);
            if(report.summary.result!=UnityEditor.Build.Reporting.BuildResult.Succeeded) throw new Exception("Unity WebGL build failed");
            File.WriteAllText(Path.Combine(output,"build-info.json"),JsonUtility.ToJson(info,true));
            UnityEngine.Debug.Log("WebGL built at Builds/WebGL. Publish with: node tools/publish-webgl.mjs");
        }
    }
}
