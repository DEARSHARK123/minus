import { z } from 'zod';
import { Tool, ToolResult } from '@/types/tool';
import { codeExecutorTool } from './code-executor';
import { truncateResult } from './sandbox';

const dataAnalyzerSchema = z.object({
  data: z.union([z.string(), z.array(z.record(z.string(), z.any()))]).describe('Data to analyze (JSON string or array)'),
  analysisType: z.enum(['summary', 'statistics', 'visualization', 'cleaning']).describe('Type of analysis'),
  columns: z.array(z.string()).optional().describe('Specific columns to analyze'),
  options: z.record(z.string(), z.any()).optional().describe('Additional analysis options'),
});

function parseData(data: string | Record<string, unknown>[]): Record<string, unknown>[] {
  if (typeof data === 'string') {
    return JSON.parse(data) as Record<string, unknown>[];
  }
  return data;
}

function summarize(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return 'No data to summarize.';

  const allCols = columns?.length ? columns : Object.keys(rows[0]);
  const lines: string[] = [
    `Rows: ${rows.length}`,
    `Columns: ${allCols.length}`,
    '',
  ];

  for (const col of allCols) {
    const values = rows.map(r => r[col]).filter(v => v !== undefined && v !== null && v !== '');
    const missing = rows.length - values.length;
    const sampleValues = [...new Set(values.map(String))].slice(0, 5);
    lines.push(`  ${col}: ${missing} missing | sample: ${sampleValues.join(', ')}`);
  }

  return lines.join('\n');
}

function computeStatistics(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return 'No data for statistics.';

  const allCols = columns?.length ? columns : Object.keys(rows[0]);
  const lines: string[] = [];

  for (const col of allCols) {
    const nums = rows
      .map(r => r[col])
      .filter(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v))))
      .map(Number);

    if (nums.length === 0) {
      lines.push(`${col}: non-numeric column (${rows.length} values)`);
      continue;
    }

    nums.sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const median = nums.length % 2 === 0
      ? (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
      : nums[Math.floor(nums.length / 2)];
    const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
    const stdDev = Math.sqrt(variance);

    lines.push(`${col}: min=${nums[0]}, max=${nums[nums.length - 1]}, mean=${mean.toFixed(2)}, median=${median.toFixed(2)}, std=${stdDev.toFixed(2)}, count=${nums.length}`);
  }

  return lines.join('\n');
}

export const dataAnalyzerTool: Tool = {
  name: 'data_analyzer',
  description: 'Analyze data and generate insights. Supports summary, statistics, visualization, and cleaning operations.',
  parameters: dataAnalyzerSchema,
  isDangerous: true,
  capability: {
    keywords: {
      zh: ['分析', '统计', '计算', '清洗', '整理', '汇总', '趋势', '图表', '可视化'],
      en: ['analyze', 'analysis', 'statistics', 'calculate', 'clean', 'summary', 'trend', 'chart', 'visualize'],
    },
    intents: ['data_analysis', 'statistics', 'data_cleaning', 'visualization'],
  },
  execute: async (params): Promise<ToolResult> => {
    const { data, analysisType, columns } = params as z.infer<typeof dataAnalyzerSchema>;

    if (!data) {
      return { success: false, error: 'No data provided. Please provide data to analyze.' };
    }

    let rows: Record<string, unknown>[];
    try {
      rows = parseData(data);
    } catch {
      return { success: false, error: 'Failed to parse data. Ensure it is valid JSON array of objects.' };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: false, error: 'Data must be a non-empty array of objects.' };
    }

    switch (analysisType) {
      case 'summary':
        return { success: true, data: truncateResult(summarize(rows, columns)) };

      case 'statistics':
        return { success: true, data: truncateResult(computeStatistics(rows, columns)) };

      case 'visualization':
      case 'cleaning': {
        const code = buildPythonAnalysis(rows, analysisType, columns);
        return await codeExecutorTool.execute({ code, language: 'python', timeout: 30000 });
      }

      default:
        return { success: false, error: `Unknown analysis type: ${analysisType}` };
    }
  },
};

function buildPythonAnalysis(
  rows: Record<string, unknown>[],
  analysisType: string,
  columns?: string[],
): string {
  const jsonData = JSON.stringify(rows);
  const colList = columns ? JSON.stringify(columns) : 'None';

  if (analysisType === 'visualization') {
    return `import json, sys
try:
    import pandas as pd
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
except ImportError:
    print("Install pandas and matplotlib: pip install pandas matplotlib")
    sys.exit(1)

data = json.loads('${jsonData.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')
df = pd.DataFrame(data)
cols = ${colList}
if cols:
    df = df[cols]

numeric_cols = df.select_dtypes(include='number').columns.tolist()
if numeric_cols:
    df[numeric_cols].plot(kind='bar', figsize=(10, 6))
    plt.title('Data Visualization')
    plt.tight_layout()
    plt.savefig('/tmp/chart.png', dpi=100)
    print(f"Chart saved to /tmp/chart.png (columns: {numeric_cols})")
else:
    print("No numeric columns found for visualization.")
    print(df.describe(include='all').to_string())`;
  }

  return `import json, sys
try:
    import pandas as pd
except ImportError:
    print("Install pandas: pip install pandas")
    sys.exit(1)

data = json.loads('${jsonData.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')
df = pd.DataFrame(data)
cols = ${colList}
if cols:
    df = df[cols]

print("Shape:", df.shape)
print("\\nColumn types:")
print(df.dtypes.to_string())
print("\\nMissing values:")
print(df.isnull().sum().to_string())
print("\\nCleaned data (rows with nulls removed):")
cleaned = df.dropna()
print(f"  {len(cleaned)} rows after cleaning (from {len(df)})")
print("\\nDescriptive statistics:")
print(df.describe().to_string())`;
}
