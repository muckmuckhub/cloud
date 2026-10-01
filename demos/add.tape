# 4. cloud add: the preset list, one preset as a diff you confirm, and rolling
# it out without dropping the lobby. Booting servers happens off camera.
Output docs/assets/demos/add.mp4
Source demos/settings.tape
Set Height 900

Hide
Type "bash /repo/demos/fixtures/up.sh story-init && cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Wait@600s /\$\s*$/
Show

Type "cloud add"
Sleep 1s
Enter
Sleep 7s

Hide
Type "clear"
Enter
Show
Type "cloud add viaversion"
Sleep 1s
Enter
Wait@20s /Add "viaversion"\?/
Sleep 9s
Type "y"
Sleep 600ms
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show
Type "cloud apply --rolling"
Sleep 1s
Enter
Wait@30s /reconcile\?/
Sleep 5s
Type "y"
Sleep 600ms
Enter
Wait+Screen@60s /cycling lobby/
Sleep 3s
Hide
Wait+Screen@300s /lobby-1 .*ready in/
Show
Sleep 3s
Hide
Wait+Screen@300s /lobby-2 .*ready in/
Show
Sleep 3s
Wait+Screen@120s /network is up/
Sleep 9s
