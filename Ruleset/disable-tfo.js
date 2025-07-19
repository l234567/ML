let nodes = $subscription.nodes;

nodes.forEach(node => {
  // 直接将 tfo 设置为 false，无论它之前是什么状态
  node.tfo = false;
});

$done({ nodes: nodes });