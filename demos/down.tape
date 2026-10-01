# 9. cloud down: stop and keep everything; --volumes asks before deleting the
# worlds. The end of the story: the network is gone afterwards.
Output docs/assets/demos/down.mp4
Source demos/settings.tape
Set Height 840

Hide
Type "bash /repo/demos/fixtures/up.sh story-added && cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Wait@600s /\$\s*$/
Show

Type "cloud down"
Sleep 1s
Enter
Wait+Screen@120s /stopped/
Sleep 5s

Type "cloud status"
Sleep 1s
Enter
Wait+Screen@30s /not running/
Sleep 8s

Hide
Type "clear"
Enter
Show
Type "cloud down --volumes"
Sleep 1s
Enter
Wait@20s /Really delete/
Sleep 8s
Type "n"
Sleep 800ms
Enter
Sleep 6s

Hide
Type "cloud down --volumes -y >/dev/null 2>&1; clear"
Enter
Wait@120s /\$\s*$/
