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
							<a-input v-model:value="searchFormState.searchKey" placeholder="课程名称或代码" allow-clear />
						</a-form-item>
					</a-col>
					<a-col :xs="24" :sm="8" :md="8" :lg="8" :xl="8">
						<a-form-item name="status" label="状态">
							<a-select v-model:value="searchFormState.status" placeholder="全部状态" allow-clear>
								<a-select-option value="active">启用</a-select-option>
								<a-select-option value="inactive">停用</a-select-option>
							</a-select>
						</a-form-item>
					</a-col>
					<a-col :xs="24" :sm="8" :md="8" :lg="8" :xl="8">
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
						<a-button type="primary" @click="formRef.onOpen(undefined, searchFormState.orgId)" v-if="hasPerm('bizCourseAdd')">
							<template #icon><plus-outlined /></template>
							新增
						</a-button>
						<a-button @click="importModalRef.onOpen()" v-if="hasPerm('bizCourseImport')">
							<template #icon><UploadOutlined /></template>
							批量导入
						</a-button>
						<xn-batch-button
							v-if="hasPerm('bizCourseBatchDelete')"
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
						<a @click="formRef.onOpen(record)" v-if="hasPerm('bizCourseEdit')">编辑</a>
						<a-divider type="vertical" v-if="hasPerm(['bizCourseEdit', 'bizCourseDelete'], 'and')" />
						<a-popconfirm title="确定删除此课程？" @confirm="removeOne(record)">
							<a-button type="link" danger size="small" v-if="hasPerm('bizCourseDelete')">删除</a-button>
						</a-popconfirm>
					</template>
				</template>
			</s-table>
		</template>
	</XnResizablePanel>
	<Form ref="formRef" :tree-data="treeData" :on-load-data="onLoadData" @successful="tableRef.refresh(true)" />
	<BizImportModal
		ref="importModalRef"
		title="批量导入课程"
		:template-api="bizCourseApi.courseImportTemplate"
		:import-api="bizCourseApi.courseImport"
		@successful="tableRef.refresh(true)"
	/>
</template>

<script setup name="bizCourse">
	import { Empty } from 'ant-design-vue'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import { useOrgTree } from '@/views/biz/components/useOrgTree'
	import BizImportModal from '@/views/biz/components/BizImportModal.vue'
	import Form from './form.vue'

	const columns = [
		{ title: '开课学院', dataIndex: 'orgName' },
		{ title: '课程代码', dataIndex: 'courseCode' },
		{ title: '课程名称', dataIndex: 'courseName' },
		{ title: '学分', dataIndex: 'credit' },
		{ title: '状态', dataIndex: 'status' },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizCourseEdit', 'bizCourseDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 150 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const importModalRef = ref()
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
	} = useOrgTree(bizCourseApi.orgTreeSelector, (orgId) => {
		if (orgId) searchFormState.value.orgId = orgId
		else delete searchFormState.value.orgId
		tableRef.value.refresh(true)
	})

	const loadData = (parameter) => bizCourseApi.coursePage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		delete searchFormState.value.orgId
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizCourseApi.courseDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizCourseApi.courseDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
