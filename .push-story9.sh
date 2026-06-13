#!/bin/bash
set -e
cd /mnt/e/my_project/ainize/ChorusGate_dev
R=AINIZE-SPACE/ChorusGate
B=v3/story-8-claude-stream-json
G="/mnt/c/Program Files/GitHub CLI/gh.exe"
W=/mnt/e/my_project/ainize/ChorusGate_dev/.push-tmp
mkdir -p 
P=4d74e7b2697928eedd9e02e169df235789fa5a80
T=
echo "parent= tree="
I=/items.json
echo -n "[" > 
F=1
for f in docs/tests/REVIEW-STORY9-2026-06-13-xiaoma.md docs/tests/ISSUES-STORY9-2026-06-13.md docs/tests/issue-bodies/P0-1.md docs/tests/issue-bodies/P0-2.md docs/tests/issue-bodies/P1-1.md docs/tests/issue-bodies/P1-2.md docs/tests/issue-bodies/P2-1.md docs/tests/issue-bodies/P2-2.md; do
  B64=
  printf '{"content":"%s","encoding":"base64"}' "" > /b.json
  S=
  echo "blob  = "
  if [  -eq 0 ]; then printf "," >> ; fi
  printf '{"path":"%s","mode":"100644","type":"blob","sha":"%s"}' "" "" >> 
  F=0
done
echo -n "]" >> 
printf '{"base_tree":"%s","tree":' "" > /t.json
cat  >> /t.json
echo -n "}" >> /t.json
echo "tree req built, size: "
NT=
echo "ntree="
cat > /c.json <<CEOF
{"message":"review(STORY-9): add REVIEW + ISSUES + issue body files (#41-46)","tree":"","parents":[""],"author":{"name":"xiaoma","email":"xiaoma@chorusgate-review.local"},"committer":{"name":"xiaoma","email":"xiaoma@chorusgate-review.local"}}
CEOF
NC=
echo "ncommit="
printf '{"sha":"%s"}' "" > /r.json
"" api -X PATCH repos//git/refs/heads/ --input /r.json
echo "DONE pushed  to "
