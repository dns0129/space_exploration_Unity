#!/usr/bin/env python3
"""Create stable Unity asset GUIDs without requiring the editor; retain existing GUIDs."""
import hashlib
from pathlib import Path

root = Path(__file__).resolve().parent.parent
for item in sorted((root / 'Assets').rglob('*')):
    if item.suffix == '.meta':
        continue
    meta = Path(str(item) + '.meta')
    if meta.exists():
        continue
    relative = item.relative_to(root).as_posix()
    guid = hashlib.md5(relative.encode()).hexdigest()
    text = f'fileFormatVersion: 2\nguid: {guid}\n'
    if item.is_dir():
        text += 'folderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n'
    else:
        importer = {'.cs': 'MonoImporter', '.asmdef': 'AssemblyDefinitionImporter', '.shader': 'ShaderImporter', '.bytes': 'TextScriptImporter', '.json': 'TextScriptImporter', '.jpg': 'TextureImporter'}.get(item.suffix, 'DefaultImporter')
        text += f'{importer}:\n  externalObjects: {{}}\n'
        if importer == 'MonoImporter':
            text += '  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n'
        elif importer == 'TextureImporter':
            text += '  serializedVersion: 12\n  mipmaps:\n    enableMipMap: 1\n    sRGBTexture: 1\n  maxTextureSize: 4096\n  textureType: 0\n  textureShape: 1\n  isReadable: 0\n  textureSettings:\n    serializedVersion: 2\n    filterMode: 1\n    aniso: 4\n    wrapU: 0\n    wrapV: 1\n    wrapW: 1\n  platformSettings: []\n'
        text += '  userData:\n  assetBundleName:\n  assetBundleVariant:\n'
    meta.write_text(text)
scene_guid = hashlib.md5(b'Assets/Voyager/Scenes/Exploration.unity').hexdigest()
(root / 'ProjectSettings/EditorBuildSettings.asset').write_text(f'''%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1045 &1
EditorBuildSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Scenes:
  - enabled: 1
    path: Assets/Voyager/Scenes/Exploration.unity
    guid: {scene_guid}
  m_configObjects: {{}}
''')
print('Unity asset metadata and build scene generated.')
