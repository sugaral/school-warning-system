<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="学号 / 姓名 / 学期" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="termCode" label="学期">
						<a-input v-model:value="searchFormState.termCode" placeholder="如 2025-2026-1" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
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
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
					<a-form-item name="passStatus" label="状态">
						<a-select v-model:value="searchFormState.passStatus" placeholder="全部" allow-clear>
							<a-select-option value="pass">及格</a-select-option>
							<a-select-option value="fail">挂科</a-select-option>
							<a-select-option value="unknown">未知</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
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
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizGradeAdd')">
						<template #icon><plus-outlined /></template>
						录入成绩
					</a-button>
					<a-button @click="importModalRef.onOpen()" v-if="hasPerm('bizGradeImport')">
						<template #icon><UploadOutlined /></template>
						批量导入
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizGradeBatchDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'passStatus'">
					<a-tag :color="record.passStatus === 'pass' ? 'green' : record.passStatus === 'fail' ? 'red' : 'default'">
						{{ record.passStatus === 'pass' ? '及格' : record.passStatus === 'fail' ? '挂科' : '未知' }}
					</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a @click="formRef.onOpen(record)" v-if="hasPerm('bizGradeEdit')">编辑</a>
					<a-divider type="vertical" v-if="hasPerm(['bizGradeEdit', 'bizGradeDelete'], 'and')" />
					<a-popconfirm title="确定删除此成绩记录？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizGradeDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<BizImportModal
		ref="importModalRef"
		title="批量导入学生成绩"
		:template-api="bizGradeApi.gradeImportTemplate"
		:import-api="bizGradeApi.gradeImport"
		@successful="tableRef.refresh(true)"
	/>
</template>

<script setup name="bizGrade">
	import bizGradeApi from '@/api/biz/bizGradeApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import BizImportModal from '@/views/biz/components/BizImportModal.vue'
	import Form from './form.vue'

	const columns = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '课程代码', dataIndex: 'courseCode' },
		{ title: '课程名称', dataIndex: 'courseName' },
		{ title: '学期', dataIndex: 'termCode' },
		{ title: '成绩', dataIndex: 'score' },
		{ title: '绩点', dataIndex: 'gradePoint' },
		{ title: '及格状态', dataIndex: 'passStatus' },
		{ title: '来源', dataIndex: 'source' },
		{ title: '录入时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizGradeEdit', 'bizGradeDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 140 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const importModalRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const courseOptions = ref([])

	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	bizCourseApi.courseList({}).then((data) => {
		courseOptions.value = data || []
	})

	const loadData = (parameter) => bizGradeApi.gradePage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizGradeApi.gradeDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizGradeApi.gradeDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
