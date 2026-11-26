import { triggerRef, onMounted, onActivated, onUnmounted } from 'vue'

/**
 * 复用学院懒加载组织树状态与自适应高度
 */
export function useOrgTree(orgTreeApi, onSelectedCallback) {
	const treeData = ref([])
	const treeLoading = ref(true)
	const treeSearchKey = ref('')
	const searchMode = ref(false)
	const defaultExpandedKeys = ref([])
	const treeLoadedKeys = ref([])
	const treeContainerRef = ref(null)
	const treeHeight = ref(0)
	let resizeObserver = null

	const treeFieldNames = { children: 'children', title: 'name', key: 'id' }
	const treeSelectFieldNames = { children: 'children', label: 'name', value: 'id' }

	const calcTreeHeight = () => {
		if (treeContainerRef.value) {
			treeHeight.value = Math.max(200, treeContainerRef.value.clientHeight - 40)
		}
	}

	onMounted(() => {
		calcTreeHeight()
		if (treeContainerRef.value) {
			resizeObserver = new ResizeObserver(calcTreeHeight)
			resizeObserver.observe(treeContainerRef.value)
		}
	})
	onActivated(calcTreeHeight)
	onUnmounted(() => {
		if (resizeObserver) resizeObserver.disconnect()
	})

	const collectTreeKeys = (nodes) => {
		const keys = []
		const walk = (list) => {
			if (!list) return
			list.forEach((n) => {
				keys.push(n.id)
				if (n.children) walk(n.children)
			})
		}
		walk(nodes)
		return keys
	}

	const loadTreeData = () => {
		treeLoading.value = true
		orgTreeApi()
			.then((res) => {
				if (res !== null) {
					treeLoadedKeys.value = []
					defaultExpandedKeys.value = []
					treeData.value = res.map((item) => ({
						...item,
						isLeaf: item.isLeaf === undefined ? false : item.isLeaf
					}))
					if (treeData.value.length === 1) {
						defaultExpandedKeys.value = [treeData.value[0].id]
					}
				}
			})
			.finally(() => {
				treeLoading.value = false
			})
	}

	const onTreeSearch = (value) => {
		if (!value || !value.trim()) {
			treeData.value = []
			defaultExpandedKeys.value = []
			treeLoadedKeys.value = []
			searchMode.value = false
			loadTreeData()
			return
		}
		treeLoading.value = true
		searchMode.value = true
		orgTreeApi({ searchKey: value.trim() })
			.then((res) => {
				treeData.value = res || []
				defaultExpandedKeys.value = collectTreeKeys(treeData.value)
			})
			.finally(() => {
				treeLoading.value = false
			})
	}

	const onLoadData = (treeNode) => {
		return new Promise((resolve) => {
			if (treeNode.dataRef.children || treeNode.dataRef.isLeaf) {
				resolve()
				return
			}
			orgTreeApi({ parentId: treeNode.dataRef.id })
				.then((res) => {
					treeNode.dataRef.children = (res || []).map((item) => ({
						...item,
						isLeaf: item.isLeaf === undefined ? false : item.isLeaf
					}))
					triggerRef(treeData)
					resolve()
				})
				.catch(() => resolve())
		})
	}

	const treeSelect = (selectedKeys) => {
		const selectedOrgId = selectedKeys.length > 0 ? selectedKeys.toString() : undefined
		if (onSelectedCallback) onSelectedCallback(selectedOrgId)
	}

	loadTreeData()

	return {
		treeData,
		treeLoading,
		treeSearchKey,
		searchMode,
		defaultExpandedKeys,
		treeLoadedKeys,
		treeContainerRef,
		treeHeight,
		treeFieldNames,
		treeSelectFieldNames,
		loadTreeData,
		onTreeSearch,
		onLoadData,
		treeSelect
	}
}
