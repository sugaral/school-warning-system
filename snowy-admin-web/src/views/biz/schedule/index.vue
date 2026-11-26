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
					<a-form-item name="status" label="状态">
						<a-select v-model:value="searchFormState.status" placeholder="全部状态" allow-clear>
							<a-select-option value="active">启用</a-select-option>
							<a-select-option value="inactive">停用</a-select-option>
						</a-select>
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
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizScheduleAdd')">
						<template #icon><plus-outlined /></template>
						新增
					</a-button>
					<a-button @click="importModalRef.onOpen()" v-if="hasPerm('bizScheduleImport')">
						<template #icon><UploadOutlined /></template>
						批量导入
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizScheduleBatchDelete')"
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
					<a @click="formRef.onOpen(record)" v-if="hasPerm('bizScheduleEdit')">编辑</a>
					<a-divider type="vertical" v-if="hasPerm(['bizScheduleEdit', 'bizScheduleDelete'], 'and')" />
					<a-popconfirm title="确定删除此排课？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizScheduleDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<BizImportModal
		ref="importModalRef"
		title="批量导入排课课表"
		:template-api="bizScheduleApi.scheduleImportTemplate"
		:import-api="bizScheduleApi.scheduleImport"
		@successful="tableRef.refresh(true)"
	/>
</template>

<script setup name="bizSchedule">
	import bizScheduleApi from '@/api/biz/bizScheduleApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import BizImportModal from '@/views/biz/components/BizImportModal.vue'
	import Form from './form.vue'

	const columns = [
		{ title: '学期编码', dataIndex: 'termCode' },
		{ title: '课程名称', dataIndex: 'courseName' },
		{ title: '班级名称', dataIndex: 'className' },
		{ title: '任课教师', dataIndex: 'teacherName' },
		{ title: '上课时间', dataIndex: 'sessionStart' },
		{ title: '下课时间', dataIndex: 'sessionEnd' },
		{ title: '签到有效(分)', dataIndex: 'expireMinutes' },
		{ title: '状态', dataIndex: 'status' }
	]
	if (hasPerm(['bizScheduleEdit', 'bizScheduleDelete'])) {
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

	const loadData = (parameter) => bizScheduleApi.schedulePage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizScheduleApi.scheduleDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizScheduleApi.scheduleDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
