/* AlgoDojo 初始数据：4 个阶段 / 37 个知识点 / 8 道起步题 */
window.ALGODOJO_SEED = (function () {
  var stages = [
    { key: 'c', name: 'C 基础', order: 1 },
    { key: 'cpp', name: 'C++ 与 STL', order: 2 },
    { key: 'algo', name: '基础算法', order: 3 },
    { key: 'ds', name: '数据结构', order: 4 }
  ];

  var raw = [
    ['c01', 'c', '变量与类型', '知道 int / long long / double / char 的范围和选型', 2],
    ['c02', 'c', '输入输出与格式化', 'scanf / printf 与 cin / cout 的区别，处理多组输入', 2],
    ['c03', 'c', '运算符与表达式', '优先级、整除与取模的坑、溢出', 2],
    ['c04', 'c', '分支结构', 'if / switch，边界条件和相等判断', 2],
    ['c05', 'c', '循环', 'for / while，循环不变式与死循环排查', 3],
    ['c06', 'c', '数组与字符串', '下标、越界、字符数组与结束符', 3],
    ['c07', 'c', '函数与递归', '参数传递、递归三要素', 3],
    ['c08', 'c', '指针', '地址、指针运算、数组退化', 3],
    ['c09', 'c', '结构体与文件', '结构体、结构体排序、文件读写', 2],

    ['p01', 'cpp', '从 C 到 C++', 'cin / cout、引用、bool，关闭同步提速', 2],
    ['p02', 'cpp', 'vector 与 string', '动态数组、字符串拼接与查找', 3],
    ['p03', 'cpp', 'sort 与自定义比较', '排序、结构体多关键字比较', 2],
    ['p04', 'cpp', 'map 与 set', '映射、集合、去重与计数', 3],
    ['p05', 'cpp', 'queue / stack / priority_queue', '三种容器的适用场景', 2],
    ['p06', 'cpp', '常用算法函数', 'lower_bound、unique、reverse、max_element', 2],

    ['a01', 'algo', '枚举与模拟', '把题意老老实实翻译成循环', 3],
    ['a02', 'algo', '时间复杂度', '估算 1e8 上限，判断会不会超时', 1],
    ['a03', 'algo', '二分查找', '有序区间、三种边界写法', 3],
    ['a04', 'algo', '二分答案', '单调性判定，把最优化转成判定', 3],
    ['a05', 'algo', '前缀和与差分', '区间求和、区间修改', 3],
    ['a06', 'algo', '双指针与滑动窗口', '利用单调性把 O(n^2) 降到 O(n)', 3],
    ['a07', 'algo', '递归', '递归树、出口、重复计算', 2],
    ['a08', 'algo', 'DFS', '连通块、排列组合、路径搜索', 3],
    ['a09', 'algo', 'BFS', '边权为 1 的最短路、层序遍历', 3],
    ['a10', 'algo', '回溯与剪枝', '全排列、N 皇后、可行性剪枝', 3],
    ['a11', 'algo', '贪心', '排序后贪心，学会举反例', 3],
    ['a12', 'algo', '排序与离散化', '去重、排名、值域压缩', 2],

    ['d01', 'ds', '链表', '数组模拟链表，指针操作', 2],
    ['d02', 'ds', '栈与队列', '括号匹配、单调队列', 3],
    ['d03', 'ds', '哈希表', '冲突处理、计数、去重', 2],
    ['d04', 'ds', '堆', '优先队列、TopK、对顶堆', 3],
    ['d05', 'ds', '并查集', '路径压缩、按秩合并、连通性', 3],
    ['d06', 'ds', '二叉树', '遍历、递归定义、完全二叉树编号', 3],
    ['d07', 'ds', '树状数组', '单点修改 + 区间查询', 3],
    ['d08', 'ds', '线段树', '区间修改 + 区间查询、懒标记', 4],
    ['d09', 'ds', '图与最短路', '邻接表存图、Dijkstra', 4],
    ['d10', 'ds', '拓扑排序与最小生成树', 'DAG 判定、Kruskal', 3]
  ];

  var topics = raw.map(function (row, i) {
    return {
      id: row[0],
      stage: row[1],
      title: row[2],
      goal: row[3],
      estimatedDays: row[4],
      order: i + 1,
      status: 'todo'
    };
  });

  var problems = [
    ['P1001', 'A+B Problem', 'c01', '入门'],
    ['P1421', '小玉买文具', 'c01', '入门'],
    ['P1425', '小鱼的游泳时间', 'c01', '入门'],
    ['P1035', '级数求和', 'c05', '入门'],
    ['P1085', '不高兴的津津', 'c05', '入门'],
    ['P1980', '计数问题', 'c05', '普及-'],
    ['P1046', '陶陶摘苹果', 'c06', '入门'],
    ['P1047', '校门外的树', 'c06', '入门']
  ];

  var resources = problems.map(function (row, i) {
    var code = row[0];
    return {
      id: 'r-' + code,
      title: code + ' ' + row[1],
      code: code,
      url: 'https://www.luogu.com.cn/problem/' + code,
      type: 'problem',
      source: '洛谷',
      difficulty: row[3],
      status: 'todo',
      note: '',
      tags: ['洛谷', '起步题'],
      topicId: row[2],
      createdAt: '2026-10-25T00:00:00.000Z',
      completedAt: null
    };
  });

  return { stages: stages, topics: topics, resources: resources };
})();