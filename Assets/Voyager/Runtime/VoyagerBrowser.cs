using System;
using System.Collections;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Voyager
{
    public static class VoyagerBrowser
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void Voyager_Download(byte[] bytes,int length,string filename);
        [DllImport("__Internal")] static extern void Voyager_Ready();
        [DllImport("__Internal")] static extern void Voyager_Message(string message);
#endif
        public static void ReportReady()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Voyager_Ready();
#endif
        }
        public static void ReportMessage(string message)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Voyager_Message(message);
#endif
        }
        public static IEnumerator CapturePhoto()
        {
            yield return new WaitForEndOfFrame();
            string name="voyager-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".png";
#if UNITY_WEBGL && !UNITY_EDITOR
            Texture2D image=ScreenCapture.CaptureScreenshotAsTexture();
            try {byte[] bytes=image.EncodeToPNG();Voyager_Download(bytes,bytes.Length,name);}
            finally {UnityEngine.Object.Destroy(image);}
#else
            ScreenCapture.CaptureScreenshot(Path.Combine(Application.persistentDataPath,name));
#endif
        }
    }
}
