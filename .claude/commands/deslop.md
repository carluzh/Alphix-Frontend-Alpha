# Remove AI code slop

Check the diff against main, and remove all AI generated slop introduced in this branch. Additionally this command can be used together with specific files, if that is the case you should scan the page and remove all AI generated slop it holds.

This includes:
- Extra comments that a human wouldn't add or is inconsistent with the rest of the file
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file
- Dead code: unused functions, unused state variables, unreachable code paths

When adding new code, cut at least the same amount elsewhere - aim for 2x. Look for:
- Unused functions or variables in the files you're touching
- State that's set but never read
- Duplicate patterns that can be consolidated

Report at the end with only a 1-3 sentence summary of what you changed