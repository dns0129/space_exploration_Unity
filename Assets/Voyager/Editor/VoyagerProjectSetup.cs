using System.IO;
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
    }
}
