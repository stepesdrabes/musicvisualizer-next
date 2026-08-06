#!/bin/bash
# Fetch the annotated corpus the analyser is measured against.
#
# Not in the repo and not redistributable. GTZAN carries beat, downbeat and meter annotations;
# GiantSteps carries tempo only. Beatport's own host for the GiantSteps audio is dead, so the
# JKU mirror is the live one; md5s from the dataset repo decide whether a file arrived intact.
#
# Idempotent: an existing, correct file is left alone, so an interrupted run resumes.
set -u
cd "$(dirname "$0")/corpus" 2>/dev/null || { mkdir -p "$(dirname "$0")/corpus"; cd "$(dirname "$0")/corpus"; }

fetch_tar() {
	local url="$1" dir="$2" tmp
	[ -d "$dir" ] && { echo "have $dir"; return; }
	tmp="$(mktemp)"
	echo "fetching $dir"
	curl -sfL "$url" -o "$tmp" && tar xzf "$tmp"
	rm -f "$tmp"
}

fetch_tar https://github.com/TempoBeatDownbeat/gtzan_mini/archive/refs/heads/main.tar.gz gtzan_mini-main
fetch_tar https://github.com/TempoBeatDownbeat/gtzan_tempo_beat/archive/refs/heads/main.tar.gz gtzan_tempo_beat-main
fetch_tar https://github.com/GiantSteps/giantsteps-tempo-dataset/archive/refs/heads/master.tar.gz giantsteps-tempo-dataset-master

mkdir -p giantsteps/audio
ok=0
fail=0
for f in giantsteps-tempo-dataset-master/md5/*.md5; do
	id="$(basename "$f" .md5)"
	out="giantsteps/audio/${id}.mp3"
	[ -s "$out" ] && { ok=$((ok + 1)); continue; }
	if curl -sfL --max-time 120 -o "$out" "https://www.cp.jku.at/datasets/giantsteps/backup/${id}.mp3"; then
		if [ "$(cat "$f")" = "$(md5 -q "$out" 2>/dev/null || md5sum "$out" | awk '{print $1}')" ]; then
			ok=$((ok + 1))
		else
			rm -f "$out"
			fail=$((fail + 1))
		fi
	else
		rm -f "$out"
		fail=$((fail + 1))
	fi
done

echo "giantsteps audio: $ok present, $fail unavailable"
echo "gtzan audio:      $(find gtzan_mini-main -name '*.wav' 2>/dev/null | wc -l | tr -d ' ') present"
