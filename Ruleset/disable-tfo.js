let nodes = $subscription.nodes;

nodes.forEach(node => {
    if (node.tfo === true) {
        node.tfo = false;
    }
    // 禁用节点中的TCP Fast Open
    node.tfo = false;
});

$done({ nodes: nodes });