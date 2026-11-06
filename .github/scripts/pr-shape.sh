#!/usr/bin/env bash
# Checks a pull request's title and description against the shape every zcxy-dev repository uses
# (dotfiles github/templates; copies elsewhere must match it). Reads TITLE and BODY from the
# environment, prints one ::error:: line per problem and exits 1 on any.
set -uo pipefail
title=${TITLE-} body=${BODY-} errors=()

# verify-deploy's automatic revert writes its own title and description, as Dependabot does; only a
# workflow can open a pull request as github-actions[bot].
if [[ ${AUTHOR-} == 'github-actions[bot]' && ${HEAD_REF-} == auto-revert/* ]]; then
  echo "Automatic revert: its title and description are verify-deploy's."; exit 0
fi

[[ $title =~ ^[a-z]+(\([a-z0-9/._-]+\))?!?:\ [^\ ] ]] ||
  errors+=("Title: use 'type(scope): what changed', e.g. 'fix(ui): Try again refetches the page'.")
(( ${#title} <= 72 )) || errors+=("Title: ${#title} characters; keep it to 72 or split the pull request.")
[[ $title == *";"* ]] && errors+=("Title: one change per pull request; a ';' joins two, so split it.")
[[ $title =~ \#[0-9] ]] && errors+=("Title: no issue numbers; write 'Closes #N' in the description.")

# Comments are the template's hints, not content.
text=$(tr -d '\r' <<< "$body" | perl -0pe 's/<!--.*?-->//gs')
last=0
for heading in Summary Verified Risk; do
  line=$(grep -nxm1 "## $heading" <<< "$text" | cut -d: -f1)
  if [[ -z $line ]]; then errors+=("Description: missing the '## $heading' section."); continue; fi
  (( line > last )) || errors+=("Description: '## $heading' comes after the section it should follow (Summary, Verified, Risk).")
  last=$line
  # The section runs to the next '## ' heading; it needs some text of its own.
  content=$(tail -n +$((line + 1)) <<< "$text" | sed '/^## /,$d' | tr -d '[:space:]')
  [[ -n $content ]] || errors+=("Description: the '## $heading' section is empty.")
done

for e in ${errors[@]+"${errors[@]}"}; do echo "::error::$e"; done
(( ${#errors[@]} == 0 ))
