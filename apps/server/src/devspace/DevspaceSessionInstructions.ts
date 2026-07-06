export const buildDevspaceSessionBriefing = (skillGuide: string): string => `

## Devspace checkout

This project is a Devspace checkout. Plain \`git\` and \`jj\` commands do not work here - use the \`ds\` CLI for all VCS operations. Guide follows.

${skillGuide}`;
