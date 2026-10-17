import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(
  defineConfig({
    title: 'Sandtable',
    description: 'A configuration-driven simulation and experimentation framework for game systems',

    // The GitHub Pages project path must match the repository name.
    base: '/sandtable/',
    lastUpdated: true,

    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/sandtable/logo.svg' }]
    ],

    locales: {
      root: {
        label: 'English',
        lang: 'en',
        themeConfig: {
          logo: '/logo.svg',
          nav: [
            { text: 'Docs', link: '/guide/01-positioning' },
            { text: 'Roadmap', link: '/guide/18-roadmap' }
          ],
          sidebar: {
            '/guide/': [
              {
                text: 'Foundations',
                items: [
                  { text: '01 · Project Positioning', link: '/guide/01-positioning' },
                  { text: '02 · Product Boundaries', link: '/guide/02-scope' },
                  { text: '03 · Core Concepts', link: '/guide/03-concepts' },
                  { text: '04 · Simulation Kernel', link: '/guide/04-kernel' },
                  { text: '05 · Time Model', link: '/guide/05-time-model' }
                ]
              },
              {
                text: 'Core Mechanics',
                items: [
                  { text: '06 · Deterministic RNG', link: '/guide/06-deterministic-rng' },
                  { text: '07 · Configuration and Formula Engine', link: '/guide/07-config-formula' },
                  { text: '08 · Technology Stack', link: '/guide/08-tech-stack' },
                  { text: '09 · Data Output', link: '/guide/09-data-output' },
                  { text: '10 · CLI', link: '/guide/10-cli' }
                ]
              },
              {
                text: 'Experiments and Analysis',
                items: [
                  { text: '11 · Experiment Pipeline', link: '/guide/11-experiment-pipeline' },
                  { text: '12 · Parameter Sweep', link: '/guide/12-parameter-sweep' },
                  { text: '13 · KPIs and Metrics', link: '/guide/13-kpi-metrics' },
                  { text: '14 · Sensitivity Analysis', link: '/guide/14-sensitivity' },
                  { text: '15 · Balance Recommendation', link: '/guide/15-recommendation' }
                ]
              },
              {
                text: 'Delivery and Progress',
                items: [
                  { text: '16 · MVP', link: '/guide/16-mvp' },
                  { text: '17 · Project Structure', link: '/guide/17-project-structure' },
                  { text: '18 · Roadmap', link: '/guide/18-roadmap' },
                  { text: '19 · Testing Strategy', link: '/guide/19-testing' },
                  { text: '20 · Design Principles and Vision', link: '/guide/20-principles-vision' },
                  { text: '21 · Real-Config Validation: The Pokémon Case', link: '/guide/21-pokemon-case' },
                  { text: '22 · Web', link: '/guide/22-web' }
                ]
              },
              {
                text: 'Research and Extensions',
                items: [
                  { text: '23 · Genre × Simulation Function Catalog', link: '/guide/23-genre-simulation' },
                  { text: '24 · Random Functions and Probability Systems', link: '/guide/24-random-functions' },
                  { text: '25 · Common Functions and Curves', link: '/guide/25-formulas-and-curves' },
                  { text: 'Script Layer Design (Python; finalized, pending phased implementation)', link: 'https://github.com/cuihairu/sandtable/blob/main/scripts/scripting-design.md' }
                ]
              }
            ]
          },
          socialLinks: [{ icon: 'github', link: 'https://github.com/cuihairu/sandtable' }],
          outline: { level: [2, 3], label: 'On this page' },
          search: {
            provider: 'local',
            options: {
              translations: {
                button: { buttonText: 'Search docs', buttonAriaLabel: 'Search docs' },
                modal: {
                  noResultsText: 'No results',
                  resetButtonTitle: 'Clear query',
                  displayDetails: 'Display details',
                  hideDetails: 'Hide details',
                  footer: { selectText: 'Select', navigateText: 'Navigate', closeText: 'Close' }
                }
              }
            }
          },
          docFooter: { prev: 'Previous page', next: 'Next page' },
          lastUpdated: { text: 'Last updated' },
          returnToTopLabel: 'Return to top',
          sidebarMenuLabel: 'Menu',
          darkModeSwitchLabel: 'Appearance',
          lightModeSwitchTitle: 'Switch to light mode',
          darkModeSwitchTitle: 'Switch to dark mode',
          footer: { message: 'Released under the Apache-2.0 License', copyright: 'Sandtable Contributors' }
        }
      },
      zh: {
        label: '简体中文',
        lang: 'zh-CN',
        title: 'Sandtable',
        description: '面向游戏系统的配置驱动仿真与实验框架 / 游戏数字沙盘',
        themeConfig: {
          logo: '/logo.svg',
          nav: [
            { text: '文档', link: '/zh/guide/01-positioning' },
            { text: '路线图', link: '/zh/guide/18-roadmap' }
          ],
          sidebar: {
            '/zh/guide/': [
              {
                text: '总纲',
                items: [
                  { text: '01 · 项目定位', link: '/zh/guide/01-positioning' },
                  { text: '02 · 产品边界', link: '/zh/guide/02-scope' },
                  { text: '03 · 核心概念', link: '/zh/guide/03-concepts' },
                  { text: '04 · 仿真内核', link: '/zh/guide/04-kernel' },
                  { text: '05 · 时间模型', link: '/zh/guide/05-time-model' }
                ]
              },
              {
                text: '核心机制',
                items: [
                  { text: '06 · 确定性随机数', link: '/zh/guide/06-deterministic-rng' },
                  { text: '07 · 配置与公式引擎', link: '/zh/guide/07-config-formula' },
                  { text: '08 · 技术栈', link: '/zh/guide/08-tech-stack' },
                  { text: '09 · 数据输出', link: '/zh/guide/09-data-output' },
                  { text: '10 · CLI', link: '/zh/guide/10-cli' }
                ]
              },
              {
                text: '实验与分析',
                items: [
                  { text: '11 · 实验管线', link: '/zh/guide/11-experiment-pipeline' },
                  { text: '12 · 参数扫描', link: '/zh/guide/12-parameter-sweep' },
                  { text: '13 · KPI 与指标', link: '/zh/guide/13-kpi-metrics' },
                  { text: '14 · 敏感性分析', link: '/zh/guide/14-sensitivity' },
                  { text: '15 · 平衡推荐', link: '/zh/guide/15-recommendation' }
                ]
              },
              {
                text: '落地与推进',
                items: [
                  { text: '16 · MVP', link: '/zh/guide/16-mvp' },
                  { text: '17 · 项目结构', link: '/zh/guide/17-project-structure' },
                  { text: '18 · 路线图', link: '/zh/guide/18-roadmap' },
                  { text: '19 · 测试策略', link: '/zh/guide/19-testing' },
                  { text: '20 · 设计原则与愿景', link: '/zh/guide/20-principles-vision' },
                  { text: '21 · 真实配置验证:宝可梦案例', link: '/zh/guide/21-pokemon-case' },
                  { text: '22 · Web 端', link: '/zh/guide/22-web' }
                ]
              },
              {
                text: '调研与扩展',
                items: [
                  { text: '23 · 游戏类型 × 仿真函数清单', link: '/zh/guide/23-genre-simulation' },
                  { text: '24 · 随机函数与概率系统', link: '/zh/guide/24-random-functions' },
                  { text: '25 · 常用函数与曲线', link: '/zh/guide/25-formulas-and-curves' },
                  { text: '脚本层设计(Python,定稿待实施)', link: 'https://github.com/cuihairu/sandtable/blob/main/scripts/scripting-design.md' }
                ]
              }
            ]
          },
          socialLinks: [{ icon: 'github', link: 'https://github.com/cuihairu/sandtable' }],
          outline: { level: [2, 3], label: '本页目录' },
          search: {
            provider: 'local',
            options: {
              translations: {
                button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
                modal: {
                  noResultsText: '没有结果',
                  resetButtonTitle: '清除查询',
                  displayDetails: '显示详情',
                  hideDetails: '隐藏详情',
                  footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
                }
              }
            }
          },
          docFooter: { prev: '上一篇', next: '下一篇' },
          lastUpdated: { text: '最后更新' },
          returnToTopLabel: '回到顶部',
          sidebarMenuLabel: '目录',
          darkModeSwitchLabel: '主题',
          lightModeSwitchTitle: '切换到亮色模式',
          darkModeSwitchTitle: '切换到暗色模式',
          footer: { message: '以 Apache-2.0 许可证发布', copyright: 'Sandtable Contributors' }
        }
      }
    },

    mermaid: { theme: 'neutral' }
  })
)
