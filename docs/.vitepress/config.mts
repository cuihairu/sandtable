import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(
  defineConfig({
    lang: 'zh-CN',
    title: 'Sandtable',
    description: '面向游戏系统的配置驱动仿真与实验框架 / 游戏数字沙盘',

    // GitHub Pages 项目页必须与仓库名一致
    base: '/sandtable/',
    lastUpdated: true,

    head: [
      // head 内不会自动拼 base,需写全路径
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/sandtable/logo.svg' }]
    ],

    // 原始计划存档不进站点,仅保留在仓库中
    srcExclude: ['**/计划-原始.md'],

    themeConfig: {
      // logo 路径由默认主题自动拼 base
      logo: '/logo.svg',

      nav: [
        { text: '文档', link: '/guide/01-positioning' },
        { text: '路线图', link: '/guide/18-roadmap' }
      ],

      sidebar: {
        '/guide/': [
          {
            text: '总纲',
            items: [
              { text: '01 · 项目定位', link: '/guide/01-positioning' },
              { text: '02 · 产品边界', link: '/guide/02-scope' },
              { text: '03 · 核心概念', link: '/guide/03-concepts' },
              { text: '04 · 仿真内核', link: '/guide/04-kernel' },
              { text: '05 · 时间模型', link: '/guide/05-time-model' }
            ]
          },
          {
            text: '核心机制',
            items: [
              { text: '06 · 确定性随机数', link: '/guide/06-deterministic-rng' },
              { text: '07 · 配置与公式引擎', link: '/guide/07-config-formula' },
              { text: '08 · 技术栈', link: '/guide/08-tech-stack' },
              { text: '09 · 数据输出', link: '/guide/09-data-output' },
              { text: '10 · CLI', link: '/guide/10-cli' }
            ]
          },
          {
            text: '实验与分析',
            items: [
              { text: '11 · 实验管线', link: '/guide/11-experiment-pipeline' },
              { text: '12 · 参数扫描', link: '/guide/12-parameter-sweep' },
              { text: '13 · KPI 与指标', link: '/guide/13-kpi-metrics' },
              { text: '14 · 敏感性分析', link: '/guide/14-sensitivity' },
              { text: '15 · 平衡推荐', link: '/guide/15-recommendation' }
            ]
          },
          {
            text: '落地与推进',
            items: [
              { text: '16 · MVP', link: '/guide/16-mvp' },
              { text: '17 · 项目结构', link: '/guide/17-project-structure' },
              { text: '18 · 路线图', link: '/guide/18-roadmap' },
              { text: '19 · 测试策略', link: '/guide/19-testing' },
              { text: '20 · 设计原则与愿景', link: '/guide/20-principles-vision' },
              { text: '21 · 真实配置验证:宝可梦案例', link: '/guide/21-pokemon-case' }
            ]
          }
        ]
      },

      socialLinks: [
        { icon: 'github', link: 'https://github.com/cuihairu/sandtable' }
      ],

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

      footer: {
        message: '以 Apache-2.0 许可证发布',
        copyright: 'Sandtable Contributors'
      }
    },

    mermaid: {
      theme: 'neutral'
    }
  })
)
