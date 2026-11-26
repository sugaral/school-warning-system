<template>
	<XnResizablePanel direction="row" :initial-size="280" :min-size="200" :max-size="450" :md="0">
		<template #left>
			<div ref="treeContainerRef" style="height: 100%; display: flex; flex-direction: column">
				<a-input-search
					v-model:value="treeSearchKey"
					placeholder="搜索学院"
					allow-clear
					style="margin-bottom: 8px; flex-shrink: 0"
					@search="onTreeSearch"
				/>
				<div style="flex: 1; overflow: hidden">
					<xn-tree-skeleton v-if="treeLoading && treeData.length === 0" />
					<a-spin v-else-if="treeData.length > 0" :spinning="treeLoading">
						<a-tree
							v-model:expandedKeys="defaultExpandedKeys"
							v-model:loadedKeys="treeLoadedKeys"
							:show-line="{ showLeafIcon: false }"
							:tree-data="treeData"
							:field-names="treeFieldNames"
							:load-data="searchMode ? undefined : onLoadData"
							:height="treeHeight"
							@select="treeSelect"
						/>
					</a-spin>
					<a-empty v-else :image="Empty.PRESENTED_IMAGE_SIMPLE" />
				</div>
			</div>
		</template>
		<template #right>
			<a-form ref="searchFormRef" :model="searchFormState">
				<a-row :gutter="10">
					<a-col :xs="24" :sm="8" :md="8" :lg="8" :xl="8">
						<a-form-item name="searchKey" label="关键词">
							<a-input v-model:value="searchFormState.searchKey" placeholder="班级名称或专业" allow-clear />
						</a-form-item>
					</a-col>
					<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
						<a-form-item name="enrollYear" label="入学年份">
							<a-input-number v-model:value="searchFormState.enrollYear" placeholder="如 2025" style="width: 100%" />
						</a-form-item>
					</a-col>
					<a-col :xs="24" :sm="10" :md="10" :lg="10" :xl="10">
						<a-form-item>
							<a-space>
								<a-button type="primary" @click="tableRef.refresh(true)">
									<template #icon><SearchOutlined /></template>
									查询
								</a-button>
								<a-button @click="reset">
									<template #icon><redo-outlined /></template>
									重置
								</a-button>
							</a-space>
						</a-form-item>
					</a-col>
				</a-row>
			</a-form>
			<s-table
				ref="tableRef"
				:columns="columns"
				:data="loadData"
				:alert="false"
				bordered
				:tool-config="{ refresh: true, height: true, columnSetting: true }"
				:row-key="(record) => record.id"
				:row-selection="options.rowSelection"
				:scroll="{ x: 'max-content' }"
			>
				<template #operator>
					<a-space>
						<a-button type="primary" @click="formRef.onOpen(undefined, searchFormState.orgId)" v-if="hasPerm('bizClassAdd')">
							<template #icon><plus-outlined /></template>
							新增
						</a-button>
						<xn-batch-button
							v-if="hasPerm('bizClassBatchDelete')"
							buttonName="批量删除"
							icon="DeleteOutlined"
							buttonDanger
							:selectedRowKeys="selectedRowKeys"
							@batchCallBack="deleteBatch"
						/>
					</a-space>
				</template>
				<template #bodyCell="{ column, record }">
					<template v-if="column.dataIndex === 'status'">
						<a-tag :color="record.status === 'active' ? 'green' : 'default'">
							{{ record.status === 'active' ? '启用' : '停用' }}
						</a-tag>
					</template>
					<template v-if="column.dataIndex === 'action'">
						<a @click="formRef.onOpen(record)" v-if="hasPerm('bizClassEdit')">编辑</a>
						<a-divider type="vertical" v-if="hasPerm(['bizClassEdit', 'bizClassDelete'], 'and')" />
						<a-popconfirm title="确定删除此班级？" @confirm="removeOne(record)">
							<a-button type="link" danger size="small" v-if="hasPerm('bizClassDelete')">删除</a-button>
						</a-popconfirm>
					</template>
				</template>
			</s-table>
		</template>
	</XnResizablePanel>
	<Form ref="formRef" :tree-data="treeData" :on-load-data="onLoadData" @successful="tableRef.refresh(true)" />
</template>

<script setup name="bizClazz">
	import { Empty } from 'ant-design-vue'
	import bizClassApi from '@/api/biz/bizClassApi'
	import { useOrgTree } from '@/views/biz/components/useOrgTree'
	import Form from './form.vue'

	const columns = [
		{ title: '所属学院', dataIndex: 'orgName' },
		{ title: '班级名称', dataIndex: 'className' },
		{ title: '专业', dataIndex: 'major' },
		{ title: '入学年份', dataIndex: 'enrollYear' },
		{ title: '年级层次', dataIndex: 'gradeLevel' },
		{ title: '班主任', dataIndex: 'counselorName' },
		{ title: '在册人数', dataIndex: 'studentCount' },
		{ title: '状态', dataIndex: 'status' }
	]
	if (hasPerm(['bizClassEdit', 'bizClassDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 150 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const {
		treeData,
		treeLoading,
		treeSearchKey,
		searchMode,
		defaultExpandedKeys,
		treeLoadedKeys,
		treeContainerRef,
		treeHeight,
		treeFieldNames,
		onTreeSearch,
		onLoadData,
		treeSelect
	} = useOrgTree(bizClassApi.orgTreeSelector, (orgId) => {
		if (orgId) searchFormState.value.orgId = orgId
		else delete searchFormState.value.orgId
		tableRef.value.refresh(true)
	})

	const loadData = (parameter) => bizClassApi.clazzPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		delete searchFormState.value.orgId
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizClassApi.clazzDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizClassApi.clazzDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
