-- Spaces installer. Copies the extension to a permanent folder, then either
-- tells you it updated (Chrome already loads it) or guides the one-time
-- "Load unpacked" step, which Chrome requires for extensions not from its store.
on run
	set appVersion to "__VERSION__"
	set extSource to (POSIX path of (path to me)) & "Contents/Resources/extension"
	set supportDir to (POSIX path of (path to application support folder from user domain)) & "Spaces"
	set extDest to supportDir & "/extension"
	try
		do shell script "mkdir -p " & quoted form of supportDir & " && rsync -a --delete " & quoted form of (extSource & "/") & " " & quoted form of (extDest & "/")
	on error errMsg
		display dialog "Spaces couldn't be copied into place." & return & return & errMsg buttons {"OK"} default button 1 with icon stop with title "Spaces"
		return
	end try

	-- Install the updater: a LaunchAgent that checks Google Cloud for new versions at
	-- login and every 6 hours, and swaps them into the folder above.
	set resDir to (POSIX path of (path to me)) & "Contents/Resources"
	set updater to supportDir & "/updater.sh"
	set agentDir to (POSIX path of (path to home folder)) & "Library/LaunchAgents"
	set agent to agentDir & "/com.bhagathon.spaces.updater.plist"
	try
		do shell script "cp " & quoted form of (resDir & "/updater.sh") & " " & quoted form of updater & " && chmod 755 " & quoted form of updater & " && mkdir -p " & quoted form of agentDir & " && sed 's#__UPDATER__#" & updater & "#' " & quoted form of (resDir & "/updater.plist") & " > " & quoted form of agent & " && (launchctl bootout gui/$(id -u) " & quoted form of agent & " 2>/dev/null; true) && launchctl bootstrap gui/$(id -u) " & quoted form of agent
	on error errMsg
		display dialog "Spaces is installed, but automatic updates couldn't be turned on." & return & return & errMsg buttons {"OK"} default button 1 with icon caution with title "Spaces"
	end try

	-- Let the extension's "Update now" button run the updater (Chrome native messaging).
	try
		do shell script "/bin/sh " & quoted form of (resDir & "/install-update-host.sh") & " " & quoted form of resDir
	end try

	-- Chrome records each unpacked extension's folder in its profile preferences.
	set chromeDir to (POSIX path of (path to application support folder from user domain)) & "Google/Chrome"
	set alreadyLoaded to do shell script "grep -Fls " & quoted form of extDest & " " & quoted form of chromeDir & "/*/Preferences " & quoted form of chromeDir & "/*/'Secure Preferences' 2>/dev/null | head -1 || true"

	if alreadyLoaded is not "" then
		display dialog "Spaces " & appVersion & " is installed." & return & return & "Chrome switches to it within 10 minutes, or right away if you restart Chrome. From now on, updates arrive on their own." buttons {"Done"} default button 1 with title "Spaces"
	else
		set the clipboard to extDest
		try
			do shell script "open -a 'Google Chrome' 'chrome://extensions/'"
		end try
		display dialog "Spaces " & appVersion & " is on your Mac. Chrome needs you to add it once:" & return & return & "1. On the Extensions page, turn on Developer mode (top right)." & return & "2. Click Load unpacked." & return & "3. Press Command-Shift-G, then Command-V, then Return, then click Select." & return & return & "The folder path is already on your clipboard. If the Extensions page didn't open, type chrome://extensions into Chrome's address bar." & return & return & "After this, updates arrive automatically; you won't need to do this again." buttons {"Done"} default button 1 with title "Spaces"
	end if
end run
