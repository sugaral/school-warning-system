<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="课程/代码/班级/学期" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
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
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="termCode" label="学期">
						<a-input v-model:value="searchFormState.termCode" placeholder="如 2026-2027-1" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
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
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizCourseClassAdd')">
						<template #icon><plus-outlined /></template>
						新增
					</a-button>
					<a-button @click="importModalRef.onOpen()" v-if="hasPerm('bizCourseClassImport')">
						<template #icon><UploadOutlined /></template>
						批量导入
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizCourseClassBatchDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'action'">
					<a @click="formRef.onOpen(record)" v-if="hasPerm('bizCourseClassEdit')">编辑</a>
					<a-divider type="vertical" v-if="hasPerm(['bizCourseClassEdit', 'bizCourseClassDelete'], 'and')" />
					<a-popconfirm title="确定删除此开课班？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizCourseClassDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<BizImportModal
		ref="importModalRef"
		title="批量导入开课班"
		:template-api="bizCourseClassApi.courseClassImportTemplate"
		:import-api="bizCourseClassApi.courseClassImport"
		@successful="tableRef.refresh(true)"
	/>
</template>

<script setup name="bizCourseClass">
	import bizCourseClassApi from '@/api/biz/bizCourseClassApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import BizImportModal from '@/views/biz/components/BizImportModal.vue'
	import Form from './form.vue'

	const columns = [
		{ title: '学期编码', dataIndex: 'termCode' },
		{ title: '课程代码', dataIndex: 'courseCode' },
		{ title: '课程名称', dataIndex: 'courseName' },
		{ title: '学分', dataIndex: 'credit' },
		{ title: '教学班级', dataIndex: 'className' },
		{ title: '任课教师', dataIndex: 'teacherName' },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizCourseClassEdit', 'bizCourseClassDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 150 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const importModalRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const classOptions = ref([])
	const selectedRowKeys = ref([])
	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	bizClassApi.clazzList().then((res) => {
		classOptions.value = res || []
	})

	const loadData = (parameter) => bizCourseClassApi.courseClassPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizCourseClassApi.courseClassDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizCourseClassApi.courseClassDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
