<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="课程名称 / 班级名称" allow-clear />
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
						<a-select v-model:value="searchFormState.status" placeholder="全部状态" allow-clear>
							<a-select-option value="active">进行中</a-select-option>
							<a-select-option value="ended">已结课</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
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
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizAttendanceAdd')">
						<template #icon><plus-outlined /></template>
						发起签到
					</a-button>
					<a-popconfirm title="确定从当前活跃排课批量开启今日未开签到课次？" @confirm="batchCreateFromSchedule">
						<a-button v-if="hasPerm('bizAttendanceAdd')" :loading="batchCreating">按排课批量开课</a-button>
					</a-popconfirm>
					<xn-batch-button
						v-if="hasPerm('bizAttendanceEnd')"
						buttonName="批量结课"
						icon="CheckCircleOutlined"
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="batchEnd"
					/>
					<xn-batch-button
						v-if="hasPerm('bizAttendanceDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'checkinModes'">
					<a-space size="small" wrap>
						<a-tag v-for="m in (record.checkinModes || ['qr'])" :key="m" color="geekblue">{{ modeLabel(m) }}</a-tag>
					</a-space>
				</template>
				<template v-if="column.dataIndex === 'status'">
					<a-tag :color="record.status === 'active' ? 'processing' : 'default'">
						{{ record.status === 'active' ? '进行中' : '已结课' }}
					</a-tag>
				</template>
				<template v-if="column.dataIndex === 'stats'">
					<a-space size="small">
						<a-tag color="blue">应到 {{ record.totalStudents ?? 0 }}</a-tag>
						<a-tag color="green">实到 {{ record.checkedInCount ?? 0 }}</a-tag>
						<a-tag color="orange">请假 {{ record.leaveCount ?? 0 }}</a-tag>
						<a-tag color="red">缺勤 {{ record.absentCount ?? 0 }}</a-tag>
					</a-space>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a @click="boardRef.onOpen(record)" v-if="hasPerm('bizAttendanceQr')">签到看板</a>
					<template v-if="record.status === 'active' && hasPerm('bizAttendanceEnd')">
						<a-divider type="vertical" />
						<a-popconfirm title="确定提前结课并结算未签到学生为缺勤？" @confirm="endOne(record)">
							<a style="color: #fa8c16">结课</a>
						</a-popconfirm>
					</template>
					<template v-if="hasPerm('bizAttendanceDelete')">
						<a-divider type="vertical" />
						<a-popconfirm title="确定删除此课次及其签到明细？" @confirm="removeOne(record)">
							<a-button type="link" danger size="small">删除</a-button>
						</a-popconfirm>
					</template>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="onCreated" />
	<SignInBoard ref="boardRef" @updated="tableRef.refresh(true)" />
</template>

<script setup name="bizAttendanceSession">
	import { message } from 'ant-design-vue'
	import bizAttendanceApi from '@/api/biz/bizAttendanceApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import Form from './form.vue'
	import SignInBoard from './SignInBoard.vue'

	const modeLabel = (m) => ({ qr: '扫码', photo: '拍照', gesture: '手势', location: '定位' }[m] || m)

	const columns = [
		{ title: '所属学院', dataIndex: 'orgName' },
		{ title: '课程名称', dataIndex: 'courseName' },
		{ title: '授课班级', dataIndex: 'className' },
		{ title: '教师', dataIndex: 'teacherName' },
		{ title: '签到方式', dataIndex: 'checkinModes' },
		{ title: '开始时间', dataIndex: 'sessionStart' },
		{ title: '截止时间', dataIndex: 'sessionEnd' },
		{ title: '出勤统计', dataIndex: 'stats' },
		{ title: '状态', dataIndex: 'status' }
	]
	if (hasPerm(['bizAttendanceQr', 'bizAttendanceEnd', 'bizAttendanceDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 200 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const boardRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const courseOptions = ref([])
	const batchCreating = ref(false)

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

	const loadData = (parameter) => bizAttendanceApi.sessionPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const onCreated = (createdPayload) => {
		tableRef.value.refresh(true)
		if (createdPayload?.sessionId) {
			boardRef.value.onOpen({ id: createdPayload.sessionId })
		}
	}

	const batchCreateFromSchedule = () => {
		batchCreating.value = true
		bizAttendanceApi
			.sessionBatchCreate({ count: 10, expireMinutes: 45 })
			.then((res) => {
				message.success(`已开启 ${res?.createdCount ?? 0} 个课次（跳过 ${res?.skippedCount ?? 0} 个已存在课次）`)
				tableRef.value.refresh(true)
			})
			.finally(() => {
				batchCreating.value = false
			})
	}

	const endOne = (record) => {
		bizAttendanceApi.sessionEnd({ id: record.id }).then((res) => {
			message.success(`课次已结课，自动标记缺勤 ${res?.absentMarked ?? 0} 人`)
			tableRef.value.refresh(true)
		})
	}

	const batchEnd = (params) => {
		bizAttendanceApi.sessionBatchEnd(params).then((res) => {
			message.success(`批量结课完成：结束 ${res?.endedCount ?? 0} 节，跳过 ${res?.skippedCount ?? 0} 节`)
			tableRef.value.clearRefreshSelected()
		})
	}

	const removeOne = (record) => {
		bizAttendanceApi.sessionDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizAttendanceApi.sessionDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
