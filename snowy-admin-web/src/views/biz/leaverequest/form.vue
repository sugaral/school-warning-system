<template>
	<xn-form-container
		title="代录请假申请"
		:width="520"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="学生档案：" name="studentId">
				<a-select
					v-model:value="formData.studentId"
					:options="studentOptions"
					placeholder="请输入学号或姓名搜索"
					show-search
					:filter-option="false"
					@search="searchStudents"
					allow-clear
				/>
			</a-form-item>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="请假开始时间：" name="fromDate">
						<a-date-picker
							v-model:value="formData.fromDate"
							show-time
							value-format="YYYY-MM-DD HH:mm:ss"
							class="xn-wd"
						/>
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="请假结束时间：" name="toDate">
						<a-date-picker
							v-model:value="formData.toDate"
							show-time
							value-format="YYYY-MM-DD HH:mm:ss"
							class="xn-wd"
						/>
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item label="请假原因：" name="reason">
				<a-textarea v-model:value="formData.reason" :rows="3" placeholder="请输入请假原因" />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizLeaveRequestForm">
	import { required } from '@/utils/formRules'
	import bizLeaveRequestApi from '@/api/biz/bizLeaveRequestApi'
	import bizStudentApi from '@/api/biz/bizStudentApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const studentOptions = ref([])

	const formRules = {
		studentId: [required('请选择学生')],
		fromDate: [required('请选择开始时间')],
		toDate: [required('请选择结束时间')],
		reason: [required('请输入请假原因')]
	}

	const searchStudents = (searchKey) => {
		bizStudentApi.studentPage({ current: 1, size: 30, searchKey: searchKey || '' }).then((page) => {
			studentOptions.value = (page?.records || []).map((s) => ({
				label: `${s.studentNo} - ${s.name}`,
				value: s.id
			}))
		})
	}

	const onOpen = () => {
		visible.value = true
		formData.value = {}
		searchStudents('')
	}

	const onClose = () => {
		visible.value = false
		formData.value = {}
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizLeaveRequestApi
					.leaveRequestAdd(formData.value)
					.then(() => {
						onClose()
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
