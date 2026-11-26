<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="学号 / 姓名 / 补录原因" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
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
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="status" label="状态">
						<a-select v-model:value="searchFormState.status" placeholder="全部" allow-clear>
							<a-select-option value="submitted">待审批</a-select-option>
							<a-select-option value="approved">已通过</a-select-option>
							<a-select-option value="rejected">已驳回</a-select-option>
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
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizMakeupRequestAdd')">
						<template #icon><plus-outlined /></template>
						代录补录
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizMakeupRequestBatchDelete')"
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
					<a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<template v-if="hasPerm('bizMakeupRequestApprove')">
						<a @click="openApproveModal(record, true)">通过</a>
						<a-divider type="vertical" />
						<a @click="openApproveModal(record, false)" style="color: #fa8c16">驳回</a>
						<a-divider type="vertical" v-if="hasPerm('bizMakeupRequestDelete')" />
					</template>
					<a-popconfirm title="确定删除此补录记录？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizMakeupRequestDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<a-modal
		v-model:open="approveVisible"
		:title="approvePayload.approve ? '确认通过补录申请' : '驳回补录申请'"
		:confirm-loading="approveLoading"
		@ok="submitApprove"
	>
		<p v-if="approvePayload.approve">确认审批通过 {{ approveTarget?.studentName }}（{{ approveTarget?.studentNo }}）的考勤补录申请？</p>
		<a-form v-else layout="vertical">
			<a-form-item label="驳回原因（必填）：" required>
				<a-textarea v-model:value="approvePayload.rejectReason" :rows="3" placeholder="请输入驳回原因" />
			</a-form-item>
		</a-form>
	</a-modal>
</template>

<script setup name="bizMakeupRequest">
	import { message } from 'ant-design-vue'
	import bizMakeupRequestApi from '@/api/biz/bizMakeupRequestApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import Form from './form.vue'

	const columns = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '学生姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '补录日期', dataIndex: 'recordDate' },
		{ title: '关联课程', dataIndex: 'courseName' },
		{ title: '补录原因', dataIndex: 'reason', ellipsis: true },
		{ title: '变更内容', dataIndex: 'changeJson', ellipsis: true },
		{ title: '状态', dataIndex: 'status' },
		{ title: '审批人', dataIndex: 'approverName' },
		{ title: '驳回原因', dataIndex: 'rejectReason', ellipsis: true },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizMakeupRequestApprove', 'bizMakeupRequestDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 170 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const courseOptions = ref([])

	const approveVisible = ref(false)
	const approveLoading = ref(false)
	const approveTarget = ref(null)
	const approvePayload = ref({ id: '', approve: true, rejectReason: '' })

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

	const statusLabel = (s) => (s === 'approved' ? '已通过' : s === 'rejected' ? '已驳回' : '待审批')
	const statusColor = (s) => (s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange')

	const loadData = (parameter) => bizMakeupRequestApi.makeupRequestPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const openApproveModal = (record, approve) => {
		approveTarget.value = record
		approvePayload.value = { id: record.id, approve, rejectReason: '' }
		approveVisible.value = true
	}

	const submitApprove = () => {
		if (!approvePayload.value.approve && !approvePayload.value.rejectReason?.trim()) {
			message.warning('驳回补录申请必须填写驳回原因')
			return
		}
		approveLoading.value = true
		bizMakeupRequestApi
			.makeupRequestApprove(approvePayload.value)
			.then(() => {
				approveVisible.value = false
				tableRef.value.refresh(true)
			})
			.finally(() => {
				approveLoading.value = false
			})
	}

	const removeOne = (record) => {
		bizMakeupRequestApi.makeupRequestDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizMakeupRequestApi.makeupRequestDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
