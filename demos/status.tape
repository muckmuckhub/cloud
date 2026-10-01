# 5. cloud status: what is running, how healthy, how many players, and the
# same as JSON for scripts.
Output docs/assets/demos/status.mp4
Source demos/settings.tape
Set Height 1260

Hide
Type "bash /repo/demos/fixtures/up.sh story-added && cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Wait@600s /\$\s*$/
Show

Type "cloud status"
Sleep 1s
Enter
Wait+Screen@30s /online/
Sleep 8s

Hide
Type "clear"
Enter
Show
Type "cloud status --json"
Sleep 1s
Enter
Wait+Screen@30s /"missing"/
Sleep 14s
