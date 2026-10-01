# 1. cloud init --manual: the network every other demo uses, from a handful of
# questions. No AI provider needed.
Output docs/assets/demos/init.mp4
Source demos/settings.tape
Set Height 1060

Hide
Type "bash /repo/demos/fixtures/fresh.sh "
Enter
Type "cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Show

Type "cloud init --manual"
Sleep 1s
Enter

Wait@30s /Network name/
Sleep 1.5s
Type "mynetwork"
Sleep 700ms
Enter
Wait /Port players/
Sleep 1.5s
Enter
Wait /MOTD/
Sleep 1s
Type "Survival & Friends"
Sleep 700ms
Enter
Wait /Minecraft version/
Sleep 1s
Type "1.21.10"
Sleep 700ms
Enter

Wait /Server name/
Sleep 3s
Enter
Wait /memory/
Sleep 1s
Type "1G"
Sleep 700ms
Enter
Wait /choice/
Sleep 2.5s
Enter
Wait /instances/
Sleep 1.5s
Enter

Wait /Server name/
Sleep 1.2s
Type "survival"
Sleep 700ms
Enter
Wait /memory/
Sleep 1s
Type "1G"
Sleep 700ms
Enter
Wait /choice/
Sleep 2.5s
Enter

Wait /Server name/
Sleep 1.5s
Enter

Wait@10s /Write this config/
Sleep 9s
Enter
Sleep 6s
