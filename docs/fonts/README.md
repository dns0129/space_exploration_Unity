# 浏览器中文字体

`Assets/Resources/VoyagerUI.otf` 是 Noto Sans CJK SC Regular 的字符子集，包含 Unity 界面文案、天体名称与基本英文数字，修改后的字体名称为 Voyager UI Subset。Unity WebGL 不能依赖玩家操作系统的中文字体，因此必须随游戏提供字体。

上游：`notofonts/noto-cjk`，固定提交 `f8d157532fbfaeda587e826d4cd5b21a49186f7c`。

- [原始字体](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)
- [原始许可](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE)

许可为 SIL Open Font License 1.1，完整文本保存在 [OFL.txt](OFL.txt)，发布时复制到网页 `legal/FONT-LICENSE.txt`。

新增界面中文后，安装 Python `fonttools`，下载以上固定版本的原始字体，再执行：

```sh
python3 tools/subset-ui-font.py /path/to/NotoSansCJKsc-Regular.otf
```
