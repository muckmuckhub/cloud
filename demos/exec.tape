# 7. cloud exec: console commands over RCON, no attaching to a container.
Output docs/assets/demos/exec.mp4
Source demos/settings.tape

Hide
Type "bash /repo/demos/fixtures/up.sh story-added && cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Wait@600s /\$\s*$/
Show

Type `cloud exec survival "list"`
Sleep 1s
Enter
Sleep 5s

Type `cloud exec survival "time set day"`
Sleep 1s
Enter
Sleep 5s

Type `cloud exec survival "say Hello from cloud exec"`
Sleep 1s
Enter
Sleep 4s

Type "cloud logs survival | tail -3"
Sleep 1s
Enter
Sleep 9s
