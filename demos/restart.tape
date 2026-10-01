# 8. cloud restart: one server, then the lobby group one instance at a time,
# each waited on until it is healthy. Boot time is cut; every line of output is
# shown as it arrived.
Output docs/assets/demos/restart.mp4
Source demos/settings.tape

Hide
Type "bash /repo/demos/fixtures/up.sh story-added && cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Wait@600s /\$\s*$/
Show

Type "cloud restart survival"
Sleep 1s
Enter
Wait+Screen@120s /restarted survival/
Sleep 5s

Type "cloud restart lobby --rolling"
Sleep 1s
Enter
Wait+Screen@30s /restarting lobby-1/
Sleep 4s
Hide
Wait+Screen@300s /lobby-1 .*ready in/
Show
Sleep 4s
Hide
Wait+Screen@300s /lobby-2 .*ready in/
Show
Sleep 3s
Wait+Screen@30s /complete/
Sleep 9s
