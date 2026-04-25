import pc from 'picocolors';

export function formatMathForTerminal(text: string): string {
  return text
    .replace(/```math\n([\s\S]*?)```/g, (_match, formula: string) => formatFormulaBlock(formula))
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, formula: string) => formatFormulaBlock(formula))
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, formula: string) => formatFormulaBlock(formula))
    .replace(/\$([^$\n]+)\$/g, (_match, formula: string) => pc.cyan(`$${formula}$`));
}

function formatFormulaBlock(formula: string): string {
  const clean = formula.trim();
  if (!clean) {
    return '';
  }

  const body = clean
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return `\n${pc.cyan('formula')}\n${pc.cyan(body)}\n`;
}
