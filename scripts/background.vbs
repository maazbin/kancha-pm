Option Explicit
Dim runner, nodePath, cliPath
Set runner = CreateObject("WScript.Shell")
nodePath = WScript.Arguments(0)
cliPath = WScript.Arguments(1)
runner.Run Chr(34) & nodePath & Chr(34) & " " & Chr(34) & cliPath & Chr(34) & " dashboard --notify", 0, False
