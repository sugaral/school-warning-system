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
						<a-form-item name="courseId" label="课程">
							<a-select
								v-model:value="searchFormState.courseId"
								:options="courseOptions"
								:field-names="{ label: 'courseName', value: 'id' }"
								placeholder="全部课程"
								show-search
								option-filter-prop="courseName"
								allow-clear
							/>
						</a-form-item>
					</a-col>
					<a-col :xs="24" :sm="8" :md="8" :lg="8" :xl="8">
						<a-form-item name="classId" label="班级">
							<a-select
								v-model:value="searchFormState.classId"
								:options="classOptions"
								:field-names="{ label: 'className', value: 'id' }"
								placeholder="全部班级"
								show-search
								option-filter-prop="className"
								allow-clear
							/>
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
						<a-button type="primary" @click="formRef.onOpen(searchFormState.orgId)" v-if="hasPerm('bizTeacherBindingAdd')">
							<template #icon><plus-outlined /></template>
							新增绑定
						</a-button>
						<xn-batch-button
							v-if="hasPerm('bizTeacherBindingBatchDelete')"
							buttonName="批量解绑"
							icon="DeleteOutlined"
							buttonDanger
							:selectedRowKeys="selectedRowKeys"
							@batchCallBack="deleteBatch"
						/>
					</a-space>
				</template>
				<template #bodyCell="{ column, record }">
					<template v-if="column.dataIndex === 'action'">
						<a-popconfirm title="确定解除此授课绑定？" @confirm="removeOne(record)">
							<a-button type="link" danger size="small" v-if="hasPerm('bizTeacherBindingDelete')">解绑</a-button>
						</a-popconfirm>
					</template>
				</template>
			</s-table>
		</template>
	</XnResizablePanel>
	<Form ref="formRef" :tree-data="treeData" :on-load-data="onLoadData" @successful="tableRef.refresh(true)" />
</template>

<script setup name="bizTeacherBinding">
	import { Empty } from 'ant-design-vue'
	import bizTeacherBindingApi from '@/api/biz/bizTeacherBindingApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import { useOrgTree } from '@/views/biz/components/useOrgTree'
	import Form from './form.vue'

	const columns = [
		{ title: '所属学院', dataIndex: 'orgName' },
		{ title: '授课教师', dataIndex: 'teacherName' },
		{ title: '课程名称', dataIndex: 'courseName' },
		{ title: '授课班级', dataIndex: 'className' },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm('bizTeacherBindingDelete')) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 100 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const courseOptions = ref([])
	const classOptions = ref([])

	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const loadFilterOptions = (orgId) => {
		bizCourseApi.courseList(orgId ? { orgId } : {}).then((data) => {
			courseOptions.value = data || []
		})
		bizClassApi.clazzList(orgId ? { orgId } : {}).then((data) => {
			classOptions.value = data || []
		})
	}
	loadFilterOptions()

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
		loadFilterOptions(orgId)
		tableRef.value.refresh(true)
	})

	const loadData = (parameter) => bizTeacherBindingApi.teacherBindingPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		delete searchFormState.value.orgId
		loadFilterOptions()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizTeacherBindingApi.teacherBindingDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizTeacherBindingApi.teacherBindingDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
