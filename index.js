'use strict';

/**
 * 
 * @ignore
 */
const co = require('co');

/**
 * @typedef {Object} TreeNode
 * @property {TreeNode} [_children]
 * @property {*} [_id]
 * @property {*} [_parent]
 */

/**
 *
 * @param {TreeNode[]} nodes
 * @returns {number}
 */
exports.countNodes = nodes => nodes.reduce(
    (accum, node) => accum + 1 + exports.countNodes(node._children || []),
    0
);

/**
 *
 * @param {TreeNode} root
 * @param {function(node: TreeNode): *} idFn
 * @param {TreeNode[]} accum
 */
const flattenTree = (root, idFn, accum) => {
    root._id = idFn(root);
    if (root._children) {
        root._children.forEach(node => {
            node._parent = root._id;
            flattenTree(node, idFn, accum);
        });
        delete root._children;
    }
    accum.push(root);
};

/**
 *
 * @param {TreeNode[]} nodes
 * @param {function(node: TreeNode): *} idFn
 * @returns {TreeNode[]}
 */
exports.flattenTree = (nodes, idFn) => {
    const accum = [];

    nodes.forEach(node => {
        node._parent = null;
        flattenTree(node, idFn, accum);
    });

    return accum;
};

/**
 *
 * @param {TreeNode[]} nodes
 * @param {function(id: *): string} idToStringFn
 * @returns {TreeNode[]}
 */
exports.buildTree = (nodes, idToStringFn) => {
    const nodesById = new Map(),
        orphanNodesByParent = new Map(),
        ret = [];

    nodes.forEach(node => {
        const idStr = idToStringFn(node._id);
        nodesById.set(idStr, node);
        node._children = orphanNodesByParent.get(idStr) || [];

        if (node._parent === null) {
            ret.push(node);
            return;
        }

        const parentIdStr = idToStringFn(node._parent),
            parent = nodesById.get(parentIdStr);

        if (parent) {
            parent._children.push(node);
            return;
        }

        const orphanNodes = orphanNodesByParent.get(parentIdStr);

        if (orphanNodes) {
            orphanNodes.push(node);
            return;
        }

        orphanNodesByParent.set(parentIdStr, [node]);
    });

    return ret;
};

/**
 *
 * @param {TreeNode} node
 * @returns {boolean}
 */
exports.hasChildren = node => !!node._children && node._children.length > 0;

/**
 *
 * @param {TreeNode} node
 * @returns {number}
 */
exports.countChildren = node => node._children ? node._children.length : 0;

/**
 *
 * @param {TreeNode[]} nodes
 * @param {function(node: TreeNode)} fn
 */
exports.walkTree = (nodes, fn) => {
    nodes.forEach(node => {
        fn(node);
        if (exports.hasChildren(node)) exports.walkTree(node._children, fn);
    })
};

/**
 * 
 * @class TreeWalkerBase
 */
class TreeWalkerBase {
    /**
     * Constructor
     *
     * @param {TreeNode[]} nodes - Root nodes
     */
    constructor(nodes) {
        this._nodes = nodes;
        this._subtreeAbandoned = false;
        this._pushed = true;
        this._stack = [{ arr: nodes, next: 0 }];
    }

    /**
     * 
     * @abstract
     */
    next() {
        throw new Error('next() is not implemented');
    }

    /**
     * Ignores subtree of the current node.
     */
    abandonSubtree() {
        this._subtreeAbandoned = true;
    }

    /**
     * Moves current node pointer to the first root.
     */
    rewind() {
        this._subtreeAbandoned = false;
        this._pushed = true;
        this._stack = [{ arr: this._nodes, next: 0 }];
    }
}

/**
 *
 * @class TreeWalker
 */
class TreeWalker extends TreeWalkerBase {
    /**
     * Constructor
     *
     * @param {TreeNode[]} nodes - Root nodes
     */
    constructor(nodes) {
        super(nodes);
    }

    /**
     * Moves the current node pointer to the next node
     * and returns the current node or null if we're done.
     *
     * @returns {?TreeNode}
     */
    next() {
        if (!this._stack.length) return null;

        if (this._subtreeAbandoned && this._pushed) {
            this._stack.pop();
        }
        this._subtreeAbandoned = false;
        this._pushed = false;

        if (!this._stack.length) return null;

        const top = this._stack[this._stack.length - 1],
            node = top.arr[top.next];

        if (node) {
            if (node._children && node._children.length) {
                this._stack.push({ arr: node._children, next: 0 });
                this._pushed = true;
            }
            top.next++;
            return node;
        }
        else {
            this._stack.pop();
            return this.next();
        }
    }
}

exports.TreeWalker = TreeWalker;


/**
 * @typedef {Object} AsyncTreeWalkerOptions
 * @property {boolean} [saveChildren]
 */

/**
 *
 * @type {AsyncTreeWalkerOptions}
 */
const DEFAULT_ASYNC_TREE_WALKER_OPTIONS = {
    saveChildren: false
};

/**
 *
 * @class AsyncTreeWalker
 */
class AsyncTreeWalker extends TreeWalkerBase {
    /**
     * Constructor
     *
     * @param {TreeNode[]} nodes - Root nodes
     * @param {function(node: TreeNode): Promise.<TreeNode[]>} resolveChildren
     * @param {AsyncTreeWalkerOptions} [options]
     */
    constructor(nodes, resolveChildren, options) {
        super(nodes);
        this._resolveChildren = resolveChildren;
        this._options = Object.assign(
            {},
            DEFAULT_ASYNC_TREE_WALKER_OPTIONS,
            options || {}
        );
    }

    /**
     * Moves the current node pointer to the next node
     * and returns the current node or null if we're done.
     *
     * @returns {Promise.<?TreeNode>}
     */
    next() {
        const that = this;

        return co(function* () {
            if (!that._stack.length) return null;

            if (that._subtreeAbandoned && that._pushed) {
                that._stack.pop();
            }
            that._subtreeAbandoned = false;
            that._pushed = false;

            if (!that._stack.length) return null;

            const top = that._stack[that._stack.length - 1],
                node = top.arr[top.next];

            if (node) {
                const children = yield that._resolveChildren(node);
                if (that._options.saveChildren) node._children = children;
                if (children && children.length) {
                    that._stack.push({ arr: children, next: 0 });
                    that._pushed = true;
                }
                top.next++;
                return node;
            }
            else {
                that._stack.pop();
                return yield that.next();
            }
        });
    }
}

exports.AsyncTreeWalker = AsyncTreeWalker;
