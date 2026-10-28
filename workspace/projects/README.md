# Your projects

One folder per project (a brand's campaign, a product, a series), and inside it one folder per video:

```text
workspace/projects/<project>/
  project.md            the project's name and a one-line description
  <video>/
    plan.md             what your AI app plans to do (you check it before it starts)
    brief.md  feedback.md
    source/             your original footage (moved here, never changed)
    drafts/             every numbered version; voice-only WAVs in drafts/audio/
    work/ composition/  working files
```

Your AI app creates projects and videos for you: copy new footage into `workspace/drop-videos-here/` and tell it. Approved videos are copied to `workspace/finished-videos/<project>/`.
