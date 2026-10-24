# Security policy

Please do not report security problems in public issues.

Report them privately instead, through **Report a vulnerability** in this repository's [Security tab](https://github.com/brisote/diff-loupe/security). Describe the problem, the version of Diffloupe and of macOS, and how to reproduce it. You will get an answer within a week.

Security fixes go into the latest release only. Diffloupe checks GitHub for a new version and installs it when you choose Update. It downloads only from this repository's releases over HTTPS, checks the download against the SHA-256 checksum published with the release, and checks that the new app is signed as Diffloupe. The builds are signed ad hoc and not notarised, so these checks catch a broken download, not a forged release: your trust rests on GitHub and this repository. `curl -fsSL https://diffloupe.com/install.sh | bash` installs the latest release at any time.
