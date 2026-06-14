# 一条命令提交 Git

在项目根目录打开终端，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\git-submit.ps1 "你的提交说明"
```

例如：

```powershell
powershell -ExecutionPolicy Bypass -File .\git-submit.ps1 "feat: update cache optimizer"
```

不写提交说明也可以，脚本会自动生成一个带时间的提交说明：

```powershell
powershell -ExecutionPolicy Bypass -File .\git-submit.ps1
```

脚本会自动执行：

```powershell
git add -A
git commit -m "提交说明"
git push origin 当前分支
```

当前远程仓库：

```text
https://github.com/yigerende/zuixinkirors.git
```

如果提示没有需要提交的变更，说明本地文件已经和 Git 记录一致。

如果 push 时要求登录 GitHub，按终端提示完成认证，或提前配置好 GitHub Token / 凭据管理器。

脚本里的终端输出使用英文，是为了兼容 Windows PowerShell 的脚本编码解析。
